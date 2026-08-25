//! Hardware-backed logical nonce tracking and the offline "sequence lock".
//!
//! This module enforces **hard sequence tracking** for offline payments at the
//! cryptography/hardware-storage boundary, independent of the EVM account nonce.
//!
//! It provides three cooperating pieces that map directly to the security model
//! implemented on-chain by `OfflineSecurityVault.sol`:
//!
//! 1. **Hardware-backed logical nonce** — a persistent, per-account `logical_nonce`
//!    is stored through the [`PlatformStorage`] abstraction, which on device is
//!    backed by the iOS Keychain / Android Keystore (see
//!    `infrastructure::platform`). The value survives app restarts.
//!
//! 2. **Sequence lock pattern** — [`OfflineSequenceManager::sign_offline_payment`]
//!    fetches the current `logical_nonce`, binds it into the signed payload, and
//!    atomically increments + persists the new value to hardware storage *before*
//!    returning the signed payload to the mobile layer. A process-wide mutex
//!    serialises the read-modify-write so two concurrent signing requests on the
//!    device can never reserve the same sequence number.
//!
//! 3. **Local pre-flight commitment check** — [`OfflineSequenceManager::check_available_balance`]
//!    (also enforced inside `sign_offline_payment`) sums the amounts already queued
//!    offline and rejects a new signing request when
//!    `proposed_amount + pending_queued_amounts > total_escrowed_funds`, preventing
//!    local over-drafting before a signature is ever produced.
//!
//! ## Ordering guarantee
//!
//! Within the atomic section we deliberately: (a) run the pre-flight balance check,
//! (b) read the current nonce, (c) produce the signature, and only then (d) persist
//! `nonce + 1` and append the queue entry *before* the signed payload is returned.
//! This keeps the on-chain **gap-free** nonce invariant intact (a failed signature
//! never burns a sequence number) while still guaranteeing the increment is durably
//! written to hardware storage before any caller can observe the signed payload.

use crate::infrastructure::platform::PlatformStorage;
use crate::shared::error::WalletError;
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use std::sync::Mutex;

/// Storage-key prefix for the persistent logical nonce (per account).
const NONCE_KEY_PREFIX: &str = "acp_logical_nonce_v1_";
/// Storage-key prefix for the offline transaction queue (per account).
const QUEUE_KEY_PREFIX: &str = "acp_offline_queue_v1_";

fn nonce_key(account: &str) -> String {
    format!("{}{}", NONCE_KEY_PREFIX, account.to_lowercase())
}

fn queue_key(account: &str) -> String {
    format!("{}{}", QUEUE_KEY_PREFIX, account.to_lowercase())
}

/// Parse a decimal wei amount string into a `u128`.
///
/// Amounts across the crate are decimal strings (wei). `u128` comfortably covers
/// every realistic value for the supported testnets (its max ~3.4e38 wei is far
/// beyond any token supply), and overflow is rejected rather than wrapped.
fn parse_wei(s: &str) -> Result<u128, WalletError> {
    let t = s.trim();
    if t.is_empty() {
        return Err(WalletError::validation("amount cannot be empty"));
    }
    t.parse::<u128>()
        .map_err(|e| WalletError::validation(format!("invalid amount '{}': {}", s, e)))
}

/// The offline payment payload that gets signed. The `logical_nonce` is injected
/// by the sequence manager and bound into the signature digest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflinePayment {
    pub from: String,
    pub to: String,
    /// ERC-20 token address, or the zero address for the native coin.
    pub token: String,
    /// Amount in wei, as a decimal string.
    pub amount: String,
    pub logical_nonce: u64,
    pub chain_id: u64,
    /// Unix-seconds expiry for the offline payment.
    pub deadline: u64,
}

/// Caller-supplied fields for a new offline payment. The `logical_nonce` is
/// intentionally *not* part of this struct — it is assigned atomically by the
/// sequence manager so the caller can never pick or reuse one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflinePaymentInput {
    pub from: String,
    pub to: String,
    pub token: String,
    pub amount: String,
    pub chain_id: u64,
    pub deadline: u64,
}

/// A signed offline payment plus the digest that was signed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedOfflinePayment {
    pub payment: OfflinePayment,
    pub signature: Vec<u8>,
    pub digest: Vec<u8>,
}

/// A single queued (signed-but-not-yet-settled) offline payment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflineQueueEntry {
    pub logical_nonce: u64,
    pub to: String,
    pub token: String,
    pub amount: String,
    /// Hex-encoded digest, used as a stable identifier for de-queueing on settle.
    pub digest_hex: String,
}

/// The persisted offline queue for one account.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OfflineQueue {
    pub entries: Vec<OfflineQueueEntry>,
}

/// Deterministic, length-prefixed encoding of a payment, hashed with Keccak-256
/// to form the digest that the caller signs. Length-prefixing every variable
/// field makes the encoding unambiguous (no field-boundary collisions).
fn payment_digest(payment: &OfflinePayment) -> Vec<u8> {
    fn push_field(out: &mut Vec<u8>, bytes: &[u8]) {
        out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        out.extend_from_slice(bytes);
    }

    let mut out = Vec::new();
    out.extend_from_slice(b"ACP_OFFLINE_PAYMENT_V1");
    push_field(&mut out, payment.from.to_lowercase().as_bytes());
    push_field(&mut out, payment.to.to_lowercase().as_bytes());
    push_field(&mut out, payment.token.to_lowercase().as_bytes());
    push_field(&mut out, payment.amount.trim().as_bytes());
    out.extend_from_slice(&payment.logical_nonce.to_be_bytes());
    out.extend_from_slice(&payment.chain_id.to_be_bytes());
    out.extend_from_slice(&payment.deadline.to_be_bytes());

    let mut hasher = Keccak256::new();
    hasher.update(&out);
    hasher.finalize().to_vec()
}

/// Hardware-backed logical nonce + offline queue manager.
///
/// Holds a borrow of the platform storage (iOS Keychain / Android Keystore on
/// device) exactly like [`crate::core::storage::SecureStorage`]. A single instance
/// must be shared for a given account so its in-process mutex can serialise the
/// atomic reserve-and-sign operations.
pub struct OfflineSequenceManager<'a> {
    storage: &'a dyn PlatformStorage,
    /// Serialises the read-modify-write sequence lock within the process.
    lock: Mutex<()>,
}

impl<'a> OfflineSequenceManager<'a> {
    pub fn new(storage: &'a dyn PlatformStorage) -> Self {
        Self {
            storage,
            lock: Mutex::new(()),
        }
    }

    // ---- non-locking internal helpers (callers must already hold `lock`) ----

    fn read_nonce_inner(&self, account: &str) -> Result<u64, WalletError> {
        let key = nonce_key(account);
        if !self.storage.exists(&key)? {
            return Ok(0);
        }
        let raw = self.storage.retrieve(&key)?;
        let s = String::from_utf8(raw)
            .map_err(|e| WalletError::storage(format!("corrupt nonce record: {}", e)))?;
        s.trim()
            .parse::<u64>()
            .map_err(|e| WalletError::storage(format!("invalid stored nonce '{}': {}", s.trim(), e)))
    }

    fn write_nonce_inner(&self, account: &str, value: u64) -> Result<(), WalletError> {
        self.storage
            .store(&nonce_key(account), value.to_string().as_bytes())
    }

    fn load_queue_inner(&self, account: &str) -> Result<OfflineQueue, WalletError> {
        let key = queue_key(account);
        if !self.storage.exists(&key)? {
            return Ok(OfflineQueue::default());
        }
        let raw = self.storage.retrieve(&key)?;
        serde_json::from_slice(&raw)
            .map_err(|e| WalletError::storage(format!("corrupt offline queue: {}", e)))
    }

    fn save_queue_inner(&self, account: &str, queue: &OfflineQueue) -> Result<(), WalletError> {
        let bytes = serde_json::to_vec(queue)
            .map_err(|e| WalletError::storage(format!("failed to serialise queue: {}", e)))?;
        self.storage.store(&queue_key(account), &bytes)
    }

    fn pending_total_inner(&self, account: &str) -> Result<u128, WalletError> {
        let queue = self.load_queue_inner(account)?;
        let mut total: u128 = 0;
        for e in &queue.entries {
            let amt = parse_wei(&e.amount)?;
            total = total
                .checked_add(amt)
                .ok_or_else(|| WalletError::validation("pending queue total overflow"))?;
        }
        Ok(total)
    }

    /// Enforce `proposed + pending <= escrow`. Returns the parsed proposed amount.
    fn check_balance_inner(
        &self,
        account: &str,
        proposed_amount: &str,
        total_escrowed: &str,
    ) -> Result<u128, WalletError> {
        let proposed = parse_wei(proposed_amount)?;
        let escrow = parse_wei(total_escrowed)?;
        let pending = self.pending_total_inner(account)?;
        let needed = pending
            .checked_add(proposed)
            .ok_or_else(|| WalletError::validation("amount + pending overflow"))?;
        if needed > escrow {
            return Err(WalletError::validation(format!(
                "insufficient escrow: pending {} + proposed {} = {} exceeds escrowed {}",
                pending, proposed, needed, escrow
            )));
        }
        Ok(proposed)
    }

    // ---- public API (each takes the lock exactly once) ----

    /// Read the current (next-to-use) logical nonce for an account. Defaults to 0
    /// when nothing has been stored yet.
    pub fn current_nonce(&self, account: &str) -> Result<u64, WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        self.read_nonce_inner(account)
    }

    /// Atomically reserve the current logical nonce: read → persist(read + 1) →
    /// return read. The increment is written to hardware storage **before** the
    /// value is returned, so a concurrent signer or a crash can never hand out the
    /// same sequence number twice.
    ///
    /// Prefer [`Self::sign_offline_payment`] for the full flow; this primitive is
    /// exposed for callers that manage signing separately.
    pub fn reserve_nonce(&self, account: &str) -> Result<u64, WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        let current = self.read_nonce_inner(account)?;
        let next = current
            .checked_add(1)
            .ok_or_else(|| WalletError::validation("logical nonce overflow"))?;
        self.write_nonce_inner(account, next)?;
        Ok(current)
    }

    /// Pre-flight commitment check. Rejects when
    /// `proposed_amount + pending_queued_amounts > total_escrowed_funds`.
    pub fn check_available_balance(
        &self,
        account: &str,
        proposed_amount: &str,
        total_escrowed: &str,
    ) -> Result<(), WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        self.check_balance_inner(account, proposed_amount, total_escrowed)
            .map(|_| ())
    }

    /// Sum of all amounts currently queued offline for an account (wei).
    pub fn pending_total(&self, account: &str) -> Result<u128, WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        self.pending_total_inner(account)
    }

    /// Snapshot of the queued offline payments for an account.
    pub fn pending_entries(&self, account: &str) -> Result<Vec<OfflineQueueEntry>, WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        Ok(self.load_queue_inner(account)?.entries)
    }

    /// Remove a queued entry once its logical nonce has settled on-chain, freeing
    /// up the corresponding pending amount for future pre-flight checks.
    pub fn remove_settled(&self, account: &str, logical_nonce: u64) -> Result<bool, WalletError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;
        let mut queue = self.load_queue_inner(account)?;
        let before = queue.entries.len();
        queue.entries.retain(|e| e.logical_nonce != logical_nonce);
        let removed = queue.entries.len() != before;
        if removed {
            self.save_queue_inner(account, &queue)?;
        }
        Ok(removed)
    }

    /// The **sequence lock** flow. Under a single atomic section it:
    ///
    /// 1. runs the pre-flight balance check (over already-queued amounts),
    /// 2. reads the current `logical_nonce` and binds it into the payment,
    /// 3. invokes `sign_fn` over the payment digest,
    /// 4. and only on a successful signature persists `logical_nonce + 1` to
    ///    hardware storage and appends the queue entry — all *before* the signed
    ///    payload is returned to the caller.
    ///
    /// `sign_fn` receives the 32-byte Keccak-256 digest and must return the raw
    /// signature bytes. Keeping signing as a closure decouples this sequence logic
    /// from key management (and keeps it testable without private keys).
    pub fn sign_offline_payment<F>(
        &self,
        input: OfflinePaymentInput,
        total_escrowed: &str,
        sign_fn: F,
    ) -> Result<SignedOfflinePayment, WalletError>
    where
        F: FnOnce(&[u8]) -> Result<Vec<u8>, WalletError>,
    {
        if input.from.trim().is_empty() {
            return Err(WalletError::validation("`from` address cannot be empty"));
        }
        if input.to.trim().is_empty() {
            return Err(WalletError::validation("`to` address cannot be empty"));
        }

        let _guard = self
            .lock
            .lock()
            .map_err(|_| WalletError::internal("nonce lock poisoned"))?;

        // (1) Pre-flight commitment check — reject local over-drafting up front.
        self.check_balance_inner(&input.from, &input.amount, total_escrowed)?;

        // (2) Read current nonce and bind it into the payload.
        let current = self.read_nonce_inner(&input.from)?;
        let next = current
            .checked_add(1)
            .ok_or_else(|| WalletError::validation("logical nonce overflow"))?;

        let payment = OfflinePayment {
            from: input.from.clone(),
            to: input.to.clone(),
            token: input.token.clone(),
            amount: input.amount.clone(),
            logical_nonce: current,
            chain_id: input.chain_id,
            deadline: input.deadline,
        };
        let digest = payment_digest(&payment);

        // (3) Sign. If this fails we return early WITHOUT persisting, so the nonce
        // is not burned (preserving the on-chain gap-free invariant).
        let signature = sign_fn(&digest)?;

        // (4) Persist the increment and enqueue BEFORE returning the signed payload.
        self.write_nonce_inner(&input.from, next)?;

        let mut queue = self.load_queue_inner(&input.from)?;
        queue.entries.push(OfflineQueueEntry {
            logical_nonce: current,
            to: input.to,
            token: input.token,
            amount: input.amount,
            digest_hex: hex::encode(&digest),
        });
        self.save_queue_inner(&input.from, &queue)?;

        Ok(SignedOfflinePayment {
            payment,
            signature,
            digest,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    /// In-memory `PlatformStorage` mirroring the mock used in `core::storage` tests.
    struct MockStorage {
        data: StdMutex<HashMap<String, Vec<u8>>>,
    }

    impl MockStorage {
        fn new() -> Self {
            Self {
                data: StdMutex::new(HashMap::new()),
            }
        }
    }

    impl PlatformStorage for MockStorage {
        fn store(&self, key: &str, data: &[u8]) -> Result<(), WalletError> {
            self.data.lock().unwrap().insert(key.to_string(), data.to_vec());
            Ok(())
        }
        fn retrieve(&self, key: &str) -> Result<Vec<u8>, WalletError> {
            self.data
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .ok_or_else(|| WalletError::storage("key not found".to_string()))
        }
        fn delete(&self, key: &str) -> Result<(), WalletError> {
            self.data.lock().unwrap().remove(key);
            Ok(())
        }
        fn exists(&self, key: &str) -> Result<bool, WalletError> {
            Ok(self.data.lock().unwrap().contains_key(key))
        }
        fn list_keys(&self) -> Result<Vec<String>, WalletError> {
            Ok(self.data.lock().unwrap().keys().cloned().collect())
        }
    }

    const ALICE: &str = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
    const BOB: &str = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
    const NATIVE: &str = "0x0000000000000000000000000000000000000000";

    fn input(amount: &str) -> OfflinePaymentInput {
        OfflinePaymentInput {
            from: ALICE.to_string(),
            to: BOB.to_string(),
            token: NATIVE.to_string(),
            amount: amount.to_string(),
            chain_id: 1114,
            deadline: 9_999_999_999,
        }
    }

    fn ok_sign(_digest: &[u8]) -> Result<Vec<u8>, WalletError> {
        Ok(vec![0xAB; 65])
    }

    #[test]
    fn nonce_defaults_to_zero() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 0);
    }

    #[test]
    fn reserve_nonce_increments_and_persists() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 0);
        assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 1);
        assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 2);
        // Current now points at the next unused slot.
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 3);
    }

    #[test]
    fn nonce_persists_across_manager_instances() {
        let storage = MockStorage::new();
        {
            let mgr = OfflineSequenceManager::new(&storage);
            assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 0);
        }
        // A fresh manager over the same hardware storage sees the advanced value.
        let mgr2 = OfflineSequenceManager::new(&storage);
        assert_eq!(mgr2.current_nonce(ALICE).unwrap(), 1);
    }

    #[test]
    fn per_account_nonces_are_independent() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 0);
        assert_eq!(mgr.reserve_nonce(ALICE).unwrap(), 1);
        // Bob starts fresh.
        assert_eq!(mgr.current_nonce(BOB).unwrap(), 0);
    }

    #[test]
    fn sign_binds_nonce_and_advances_sequence() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);

        let signed = mgr
            .sign_offline_payment(input("100"), "1000", ok_sign)
            .unwrap();
        assert_eq!(signed.payment.logical_nonce, 0);
        assert_eq!(signed.signature.len(), 65);
        // Increment persisted before return.
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 1);

        let signed2 = mgr
            .sign_offline_payment(input("100"), "1000", ok_sign)
            .unwrap();
        assert_eq!(signed2.payment.logical_nonce, 1);
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 2);
    }

    #[test]
    fn digest_is_deterministic_and_nonce_sensitive() {
        let p0 = OfflinePayment {
            from: ALICE.into(),
            to: BOB.into(),
            token: NATIVE.into(),
            amount: "100".into(),
            logical_nonce: 0,
            chain_id: 1114,
            deadline: 9_999_999_999,
        };
        let mut p1 = p0.clone();
        p1.logical_nonce = 1;
        assert_eq!(payment_digest(&p0), payment_digest(&p0));
        assert_ne!(payment_digest(&p0), payment_digest(&p1));
    }

    #[test]
    fn preflight_rejects_overdraft() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        // proposed (600) alone is under escrow (1000) -> ok
        assert!(mgr.check_available_balance(ALICE, "600", "1000").is_ok());
        // proposed (1200) over escrow (1000) -> reject
        assert!(mgr.check_available_balance(ALICE, "1200", "1000").is_err());
    }

    #[test]
    fn preflight_accounts_for_pending_queue() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);

        // Queue 700 (escrow 1000) -> ok, pending becomes 700.
        mgr.sign_offline_payment(input("700"), "1000", ok_sign)
            .unwrap();
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 700);

        // A further 400 would make 1100 > 1000 -> must be rejected.
        let err = mgr
            .sign_offline_payment(input("400"), "1000", ok_sign)
            .unwrap_err();
        assert!(matches!(err, WalletError::Validation(_)));
        // Rejected signing must NOT advance the nonce (still 1 from the first sign).
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 1);

        // A 300 top-up fits exactly (700 + 300 = 1000).
        assert!(mgr
            .sign_offline_payment(input("300"), "1000", ok_sign)
            .is_ok());
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 1000);
    }

    #[test]
    fn failed_signature_does_not_burn_nonce_or_enqueue() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);

        let failing = |_d: &[u8]| -> Result<Vec<u8>, WalletError> {
            Err(WalletError::crypto("signer unavailable"))
        };
        let err = mgr
            .sign_offline_payment(input("100"), "1000", failing)
            .unwrap_err();
        assert!(matches!(err, WalletError::Crypto(_)));
        // No gap introduced, nothing queued.
        assert_eq!(mgr.current_nonce(ALICE).unwrap(), 0);
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 0);
        assert!(mgr.pending_entries(ALICE).unwrap().is_empty());
    }

    #[test]
    fn remove_settled_frees_pending_amount() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);

        mgr.sign_offline_payment(input("400"), "1000", ok_sign)
            .unwrap(); // nonce 0
        mgr.sign_offline_payment(input("300"), "1000", ok_sign)
            .unwrap(); // nonce 1
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 700);

        assert!(mgr.remove_settled(ALICE, 0).unwrap());
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 300);
        assert_eq!(mgr.pending_entries(ALICE).unwrap().len(), 1);

        // Removing a non-existent nonce reports false and changes nothing.
        assert!(!mgr.remove_settled(ALICE, 42).unwrap());
        assert_eq!(mgr.pending_total(ALICE).unwrap(), 300);
    }

    #[test]
    fn invalid_amounts_are_rejected() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        assert!(mgr.check_available_balance(ALICE, "", "1000").is_err());
        assert!(mgr.check_available_balance(ALICE, "abc", "1000").is_err());
        assert!(mgr.check_available_balance(ALICE, "-5", "1000").is_err());
    }

    #[test]
    fn empty_addresses_are_rejected() {
        let storage = MockStorage::new();
        let mgr = OfflineSequenceManager::new(&storage);
        let mut bad = input("100");
        bad.from = "".into();
        assert!(mgr.sign_offline_payment(bad, "1000", ok_sign).is_err());
    }
}
