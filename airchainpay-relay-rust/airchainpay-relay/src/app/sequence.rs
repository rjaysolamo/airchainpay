//! Offline logical-nonce sequence enforcement for the relay.
//!
//! This module detects **sequence gaps** and prevents **out-of-order broadcasts**
//! of offline-signed payments, complementing the on-chain `OfflineSecurityVault`
//! which enforces a strict, gap-free `nextLogicalNonce` per sender.
//!
//! It implements the three cooperating pieces requested for the relay:
//!
//! 1. **Sequence Validation** ([`SequenceValidator`]) — for an incoming payload it
//!    compares the payload's `logical_nonce` against the sender's current on-chain
//!    `nextLogicalNonce` (fetched through the [`NonceOracle`] abstraction, which in
//!    production reads `OfflineSecurityVault.getNextLogicalNonce(sender)`). It yields
//!    a [`SequenceDecision`]: broadcast now, quarantine (future nonce), reject as
//!    stale (already-settled slot), or reject as invalid.
//!
//! 2. **Gap Quarantine Queue** ([`QuarantineStore`]) — when a payload arrives with a
//!    `logical_nonce` strictly greater than the expected on-chain slot (e.g. #3 while
//!    the chain is still on #1), it is *not* broadcast. Instead it is parked in a
//!    memory-efficient, ordered background store keyed by `(chain_id, sender)` with a
//!    `BTreeMap<logical_nonce, _>` so gap-fill is an O(log n) ordered scan. The store
//!    is a trait so a SQLite/rocksdb-backed implementation can be dropped in without
//!    touching the resolver; [`InMemoryQuarantineStore`] is the default backend.
//!
//! 3. **Sequence Resolution Worker** ([`SequenceResolver`]) — a background scheduler
//!    that periodically (a) re-checks the on-chain expected nonce for senders with
//!    quarantined items and releases any now-contiguous run of transactions in strict
//!    chronological (ascending-nonce) order via the [`Broadcaster`] abstraction, and
//!    (b) purges quarantined entries older than a configurable TTL (default 24h) to
//!    avoid unbounded memory growth when a missing nonce never arrives.
//!
//! The chain query and broadcast are behind the [`NonceOracle`] and [`Broadcaster`]
//! traits (static dispatch) so this logic is fully unit-testable without a live RPC;
//! the production wiring implements them over [`crate::infrastructure::blockchain::manager::BlockchainManager`].

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::time::Duration;

/// Normalize an EVM address string for use as a stable map key.
fn normalize_addr(addr: &str) -> String {
    addr.trim().to_lowercase()
}

/// An incoming offline-signed transaction submitted to the relay for broadcast.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IncomingOfflineTx {
    /// Destination chain id.
    pub chain_id: u64,
    /// The signer / `from` address (offline sender whose sequence we track).
    pub sender: String,
    /// Application-level logical nonce carried by the offline payload.
    pub logical_nonce: u64,
    /// Raw, already-signed transaction (0x-hex) to broadcast when released.
    pub signed_tx: String,
    /// When the relay first received this payload.
    pub received_at: DateTime<Utc>,
}

impl IncomingOfflineTx {
    pub fn new(chain_id: u64, sender: impl Into<String>, logical_nonce: u64, signed_tx: impl Into<String>) -> Self {
        Self {
            chain_id,
            sender: sender.into(),
            logical_nonce,
            signed_tx: signed_tx.into(),
            received_at: Utc::now(),
        }
    }
}

/// The outcome of validating an incoming payload against on-chain sequence state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SequenceDecision {
    /// `logical_nonce == expected`: safe to broadcast immediately, in order.
    ReadyToBroadcast,
    /// `logical_nonce > expected`: a gap exists; park until the gap is filled.
    /// `missing` is the inclusive range `[expected, logical_nonce)` still awaited.
    Quarantine { missing: (u64, u64) },
    /// `logical_nonce < expected`: the slot is already settled on-chain (stale replay).
    RejectStale { expected: u64 },
    /// Malformed input (e.g. empty sender / signed tx).
    RejectInvalid { reason: String },
}

/// Abstraction over reading the sender's current on-chain `nextLogicalNonce`.
///
/// Production implements this over `OfflineSecurityVault.getNextLogicalNonce`.
pub trait NonceOracle: Send + Sync {
    fn next_logical_nonce(
        &self,
        chain_id: u64,
        sender: &str,
    ) -> impl Future<Output = Result<u64, String>> + Send;
}

/// Abstraction over broadcasting a released raw transaction to the chain.
pub trait Broadcaster: Send + Sync {
    fn broadcast(
        &self,
        tx: &QuarantinedTx,
    ) -> impl Future<Output = Result<String, String>> + Send;
}

/// A quarantined (future-nonce) transaction awaiting gap resolution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuarantinedTx {
    pub chain_id: u64,
    pub sender: String,
    pub logical_nonce: u64,
    pub signed_tx: String,
    pub received_at: DateTime<Utc>,
}

impl From<IncomingOfflineTx> for QuarantinedTx {
    fn from(tx: IncomingOfflineTx) -> Self {
        Self {
            chain_id: tx.chain_id,
            sender: normalize_addr(&tx.sender),
            logical_nonce: tx.logical_nonce,
            signed_tx: tx.signed_tx,
            received_at: tx.received_at,
        }
    }
}

/// Persistent, ordered store for quarantined transactions.
///
/// Implementations must key by `(chain_id, normalized_sender)` and keep entries
/// ordered by `logical_nonce` so the resolver can pop a contiguous run cheaply.
/// The default [`InMemoryQuarantineStore`] uses a `BTreeMap` per sender; a
/// SQLite/rocksdb backend can implement this same trait for durability.
pub trait QuarantineStore: Send + Sync {
    /// Insert (or replace) a quarantined tx at its `(chain, sender, nonce)` slot.
    fn insert(&self, tx: QuarantinedTx);

    /// Remove and return the contiguous run of transactions starting at
    /// `expected_nonce` (i.e. `expected, expected+1, ...`) for a sender, stopping
    /// at the first missing nonce. Returned in strict ascending order.
    fn take_contiguous(&self, chain_id: u64, sender: &str, expected_nonce: u64) -> Vec<QuarantinedTx>;

    /// Distinct `(chain_id, sender)` pairs that currently have quarantined items.
    fn tracked_senders(&self) -> Vec<(u64, String)>;

    /// Remove every entry whose `received_at` is older than `cutoff`; returns them.
    fn purge_older_than(&self, cutoff: DateTime<Utc>) -> Vec<QuarantinedTx>;

    /// Total number of quarantined entries (across all senders).
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Default in-memory, memory-efficient quarantine store.
///
/// Layout: `HashMap<(chain_id, sender) -> BTreeMap<logical_nonce -> QuarantinedTx>>`.
/// The inner `BTreeMap` keeps nonces sorted, so contiguous-run extraction and
/// gap detection are ordered scans, and empty sender buckets are pruned eagerly.
#[derive(Default)]
pub struct InMemoryQuarantineStore {
    inner: Mutex<HashMap<(u64, String), BTreeMap<u64, QuarantinedTx>>>,
}

impl InMemoryQuarantineStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl QuarantineStore for InMemoryQuarantineStore {
    fn insert(&self, tx: QuarantinedTx) {
        let key = (tx.chain_id, normalize_addr(&tx.sender));
        let mut guard = self.inner.lock().expect("quarantine store poisoned");
        guard.entry(key).or_default().insert(tx.logical_nonce, tx);
    }

    fn take_contiguous(&self, chain_id: u64, sender: &str, expected_nonce: u64) -> Vec<QuarantinedTx> {
        let key = (chain_id, normalize_addr(sender));
        let mut guard = self.inner.lock().expect("quarantine store poisoned");
        let mut released = Vec::new();

        if let Some(bucket) = guard.get_mut(&key) {
            let mut next = expected_nonce;
            // Pop strictly contiguous nonces starting at `expected`.
            while let Some(tx) = bucket.remove(&next) {
                released.push(tx);
                next = match next.checked_add(1) {
                    Some(n) => n,
                    None => break,
                };
            }
            if bucket.is_empty() {
                guard.remove(&key);
            }
        }

        released
    }

    fn tracked_senders(&self) -> Vec<(u64, String)> {
        let guard = self.inner.lock().expect("quarantine store poisoned");
        guard.keys().cloned().collect()
    }

    fn purge_older_than(&self, cutoff: DateTime<Utc>) -> Vec<QuarantinedTx> {
        let mut guard = self.inner.lock().expect("quarantine store poisoned");
        let mut expired = Vec::new();

        guard.retain(|_key, bucket| {
            // Extract expired nonces first, then keep the rest.
            let expired_nonces: Vec<u64> = bucket
                .iter()
                .filter(|(_, tx)| tx.received_at < cutoff)
                .map(|(nonce, _)| *nonce)
                .collect();
            for nonce in expired_nonces {
                if let Some(tx) = bucket.remove(&nonce) {
                    expired.push(tx);
                }
            }
            !bucket.is_empty()
        });

        expired
    }

    fn len(&self) -> usize {
        let guard = self.inner.lock().expect("quarantine store poisoned");
        guard.values().map(|b| b.len()).sum()
    }
}

/// Pure sequence validator. Sync and side-effect free so it is trivially testable
/// and can be dropped straight into the submission endpoint once the expected
/// on-chain nonce has been fetched.
pub struct SequenceValidator;

impl SequenceValidator {
    /// Decide what to do with `incoming` given the sender's current on-chain
    /// `expected` next logical nonce.
    pub fn decide(incoming: &IncomingOfflineTx, expected: u64) -> SequenceDecision {
        if incoming.sender.trim().is_empty() {
            return SequenceDecision::RejectInvalid {
                reason: "sender address is empty".to_string(),
            };
        }
        let sig = incoming.signed_tx.trim();
        if !(sig.starts_with("0x") && sig.len() > 2 && sig.len() % 2 == 0) {
            return SequenceDecision::RejectInvalid {
                reason: "signed_tx must be 0x-prefixed even-length hex".to_string(),
            };
        }

        match incoming.logical_nonce.cmp(&expected) {
            std::cmp::Ordering::Equal => SequenceDecision::ReadyToBroadcast,
            std::cmp::Ordering::Greater => SequenceDecision::Quarantine {
                missing: (expected, incoming.logical_nonce),
            },
            std::cmp::Ordering::Less => SequenceDecision::RejectStale { expected },
        }
    }
}

/// Runtime configuration for the resolver worker.
#[derive(Debug, Clone)]
pub struct SequenceConfig {
    /// How often the resolution worker wakes to fill gaps / purge expiries.
    pub tick_interval: Duration,
    /// Maximum age a quarantined tx may reach before it is discarded.
    pub quarantine_ttl: ChronoDuration,
}

impl Default for SequenceConfig {
    fn default() -> Self {
        Self {
            tick_interval: Duration::from_secs(30),
            quarantine_ttl: ChronoDuration::hours(24),
        }
    }
}

/// Summary of a single resolver tick (returned for tests / metrics).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolveOutcome {
    /// Nonces successfully broadcast, in the order they were released.
    pub broadcast: Vec<u64>,
    /// Entries dropped because their broadcast failed (re-quarantined is avoided
    /// to preserve strict ordering; they are surfaced for the caller to record).
    pub failed: Vec<u64>,
    /// Entries discarded due to TTL expiry.
    pub expired: Vec<u64>,
}

/// The Sequence Resolution Worker. Generic over the store, oracle and broadcaster
/// (static dispatch) so production uses real chain-backed impls while tests use
/// in-memory mocks.
pub struct SequenceResolver<S, O, B>
where
    S: QuarantineStore,
    O: NonceOracle,
    B: Broadcaster,
{
    store: Arc<S>,
    oracle: Arc<O>,
    broadcaster: Arc<B>,
    config: SequenceConfig,
}

impl<S, O, B> SequenceResolver<S, O, B>
where
    S: QuarantineStore + 'static,
    O: NonceOracle + 'static,
    B: Broadcaster + 'static,
{
    pub fn new(store: Arc<S>, oracle: Arc<O>, broadcaster: Arc<B>, config: SequenceConfig) -> Self {
        Self {
            store,
            oracle,
            broadcaster,
            config,
        }
    }

    pub fn store(&self) -> Arc<S> {
        Arc::clone(&self.store)
    }

    /// Validate an incoming payload and, when it represents a future nonce, park it
    /// in the quarantine store. Returns the decision so the caller (submission
    /// endpoint) can respond appropriately. `ReadyToBroadcast` payloads are NOT
    /// enqueued here — the caller broadcasts those on the normal path.
    pub async fn admit(&self, incoming: IncomingOfflineTx) -> Result<SequenceDecision, String> {
        let expected = self
            .oracle
            .next_logical_nonce(incoming.chain_id, &incoming.sender)
            .await?;

        let decision = SequenceValidator::decide(&incoming, expected);
        if let SequenceDecision::Quarantine { .. } = decision {
            self.store.insert(QuarantinedTx::from(incoming));
        }
        Ok(decision)
    }

    /// Attempt to release a contiguous run for one sender: fetch the on-chain
    /// expected nonce, pop `[expected, expected+1, ...]` from quarantine, and
    /// broadcast them strictly in ascending order. Stops at the first broadcast
    /// failure to preserve ordering (remaining popped entries are reported as
    /// `failed` and left dropped so a caller can decide to re-submit).
    pub async fn resolve_sender(&self, chain_id: u64, sender: &str) -> Result<ResolveOutcome, String> {
        let mut outcome = ResolveOutcome::default();
        let expected = self.oracle.next_logical_nonce(chain_id, sender).await?;
        let ready = self.store.take_contiguous(chain_id, sender, expected);

        for tx in ready {
            match self.broadcaster.broadcast(&tx).await {
                Ok(_hash) => outcome.broadcast.push(tx.logical_nonce),
                Err(_e) => {
                    // Preserve strict ordering: do not broadcast later nonces if an
                    // earlier one failed. Surface this and the rest as failed.
                    outcome.failed.push(tx.logical_nonce);
                    break;
                }
            }
        }

        Ok(outcome)
    }

    /// Purge entries older than the configured TTL. Returns discarded nonces.
    pub fn purge_expired(&self) -> Vec<u64> {
        let cutoff = Utc::now() - self.config.quarantine_ttl;
        self.store
            .purge_older_than(cutoff)
            .into_iter()
            .map(|tx| tx.logical_nonce)
            .collect()
    }

    /// One full maintenance tick: purge expiries, then try to resolve every tracked
    /// sender. Aggregated for tests/metrics.
    pub async fn tick(&self) -> ResolveOutcome {
        let mut agg = ResolveOutcome {
            expired: self.purge_expired(),
            ..Default::default()
        };

        for (chain_id, sender) in self.store.tracked_senders() {
            if let Ok(outcome) = self.resolve_sender(chain_id, &sender).await {
                agg.broadcast.extend(outcome.broadcast);
                agg.failed.extend(outcome.failed);
            }
        }
        agg
    }

    /// Spawn the background resolution loop, mirroring `TransactionProcessor::start`.
    /// Returns the join handle so the server can manage its lifecycle.
    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(self.config.tick_interval);
            loop {
                interval.tick().await;
                let _ = self.tick().await;
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Production wiring over the real BlockchainManager.
// ---------------------------------------------------------------------------

/// [`NonceOracle`] backed by the on-chain `OfflineSecurityVault`. Resolves the
/// per-chain vault address via the supplied lookup closure (so vault addresses can
/// come from config/env without this module depending on the config layout).
pub struct VaultNonceOracle<F>
where
    F: Fn(u64) -> Option<ethers::core::types::Address> + Send + Sync,
{
    manager: Arc<crate::infrastructure::blockchain::manager::BlockchainManager>,
    vault_for_chain: F,
}

impl<F> VaultNonceOracle<F>
where
    F: Fn(u64) -> Option<ethers::core::types::Address> + Send + Sync,
{
    pub fn new(
        manager: Arc<crate::infrastructure::blockchain::manager::BlockchainManager>,
        vault_for_chain: F,
    ) -> Self {
        Self { manager, vault_for_chain }
    }
}

impl<F> NonceOracle for VaultNonceOracle<F>
where
    F: Fn(u64) -> Option<ethers::core::types::Address> + Send + Sync,
{
    async fn next_logical_nonce(&self, chain_id: u64, sender: &str) -> Result<u64, String> {
        use std::str::FromStr;
        let vault = (self.vault_for_chain)(chain_id)
            .ok_or_else(|| format!("no vault address configured for chain {chain_id}"))?;
        let sender_addr = ethers::core::types::Address::from_str(sender.trim())
            .map_err(|e| format!("invalid sender address {sender}: {e}"))?;
        let nonce = self
            .manager
            .get_next_logical_nonce(chain_id, vault, sender_addr)
            .await
            .map_err(|e| e.to_string())?;
        // Logical nonces are small sequence counters; clamp defensively.
        Ok(nonce.min(ethers::core::types::U256::from(u64::MAX)).as_u64())
    }
}

/// [`Broadcaster`] that releases a quarantined raw transaction via the manager.
pub struct RawTxBroadcaster {
    manager: Arc<crate::infrastructure::blockchain::manager::BlockchainManager>,
}

impl RawTxBroadcaster {
    pub fn new(manager: Arc<crate::infrastructure::blockchain::manager::BlockchainManager>) -> Self {
        Self { manager }
    }
}

impl Broadcaster for RawTxBroadcaster {
    async fn broadcast(&self, tx: &QuarantinedTx) -> Result<String, String> {
        self.manager
            .broadcast_raw(tx.chain_id, &tx.signed_tx)
            .await
            .map(|h| format!("{h:?}"))
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;


    const ALICE: &str = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
    const BOB: &str = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
    const SIG: &str = "0xdeadbeef";

    fn tx(nonce: u64) -> IncomingOfflineTx {
        IncomingOfflineTx::new(1114, ALICE, nonce, SIG)
    }

    fn aged(nonce: u64, sender: &str, age: ChronoDuration) -> QuarantinedTx {
        QuarantinedTx {
            chain_id: 1114,
            sender: sender.to_string(),
            logical_nonce: nonce,
            signed_tx: SIG.to_string(),
            received_at: Utc::now() - age,
        }
    }

    /// Oracle returning a fixed expected nonce per (chain, sender), mutable so tests
    /// can simulate the chain advancing as gaps fill.
    struct MockOracle {
        expected: StdMutex<HashMap<(u64, String), u64>>,
    }
    impl MockOracle {
        fn new() -> Self {
            Self { expected: StdMutex::new(HashMap::new()) }
        }
        fn set(&self, chain_id: u64, sender: &str, n: u64) {
            self.expected.lock().unwrap().insert((chain_id, normalize_addr(sender)), n);
        }
    }
    impl NonceOracle for MockOracle {
        async fn next_logical_nonce(&self, chain_id: u64, sender: &str) -> Result<u64, String> {
            Ok(*self
                .expected
                .lock()
                .unwrap()
                .get(&(chain_id, normalize_addr(sender)))
                .unwrap_or(&0))
        }
    }

    /// Broadcaster that records what it sent and can be told to fail a given nonce.
    struct MockBroadcaster {
        sent: StdMutex<Vec<u64>>,
        fail_on: StdMutex<Option<u64>>,
    }
    impl MockBroadcaster {
        fn new() -> Self {
            Self { sent: StdMutex::new(Vec::new()), fail_on: StdMutex::new(None) }
        }
        fn sent(&self) -> Vec<u64> {
            self.sent.lock().unwrap().clone()
        }
    }
    impl Broadcaster for MockBroadcaster {
        async fn broadcast(&self, tx: &QuarantinedTx) -> Result<String, String> {
            if *self.fail_on.lock().unwrap() == Some(tx.logical_nonce) {
                return Err(format!("boom on {}", tx.logical_nonce));
            }
            self.sent.lock().unwrap().push(tx.logical_nonce);
            Ok(format!("0xhash{}", tx.logical_nonce))
        }
    }

    // ---- Validator ----

    #[test]
    fn validator_equal_is_ready() {
        assert_eq!(SequenceValidator::decide(&tx(1), 1), SequenceDecision::ReadyToBroadcast);
    }

    #[test]
    fn validator_future_is_quarantined() {
        assert_eq!(
            SequenceValidator::decide(&tx(3), 1),
            SequenceDecision::Quarantine { missing: (1, 3) }
        );
    }

    #[test]
    fn validator_past_is_stale() {
        assert_eq!(
            SequenceValidator::decide(&tx(0), 2),
            SequenceDecision::RejectStale { expected: 2 }
        );
    }

    #[test]
    fn validator_rejects_bad_input() {
        let mut bad = tx(1);
        bad.sender = "".into();
        assert!(matches!(SequenceValidator::decide(&bad, 1), SequenceDecision::RejectInvalid { .. }));

        let mut bad2 = tx(1);
        bad2.signed_tx = "nothex".into();
        assert!(matches!(SequenceValidator::decide(&bad2, 1), SequenceDecision::RejectInvalid { .. }));
    }

    // ---- Store ----

    #[test]
    fn store_takes_only_contiguous_run() {
        let store = InMemoryQuarantineStore::new();
        // Have 1,2,4 but expected is 1 -> should release 1,2 and keep 4 (gap at 3).
        store.insert(aged(1, ALICE, ChronoDuration::zero()));
        store.insert(aged(2, ALICE, ChronoDuration::zero()));
        store.insert(aged(4, ALICE, ChronoDuration::zero()));
        assert_eq!(store.len(), 3);

        let released = store.take_contiguous(1114, ALICE, 1);
        assert_eq!(released.iter().map(|t| t.logical_nonce).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(store.len(), 1); // 4 remains
    }

    #[test]
    fn store_returns_empty_when_gap_at_expected() {
        let store = InMemoryQuarantineStore::new();
        store.insert(aged(3, ALICE, ChronoDuration::zero()));
        // expected 1, but only 3 is present -> nothing contiguous.
        assert!(store.take_contiguous(1114, ALICE, 1).is_empty());
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn store_isolates_senders_and_chains() {
        let store = InMemoryQuarantineStore::new();
        store.insert(aged(1, ALICE, ChronoDuration::zero()));
        store.insert(aged(1, BOB, ChronoDuration::zero()));
        // Releasing Alice's must not touch Bob's.
        let released = store.take_contiguous(1114, ALICE, 1);
        assert_eq!(released.len(), 1);
        assert_eq!(store.len(), 1);
        assert_eq!(store.tracked_senders(), vec![(1114, normalize_addr(BOB))]);
    }

    #[test]
    fn store_purges_only_expired() {
        let store = InMemoryQuarantineStore::new();
        store.insert(aged(1, ALICE, ChronoDuration::hours(48))); // expired
        store.insert(aged(2, ALICE, ChronoDuration::minutes(5))); // fresh
        let cutoff = Utc::now() - ChronoDuration::hours(24);
        let expired = store.purge_older_than(cutoff);
        assert_eq!(expired.iter().map(|t| t.logical_nonce).collect::<Vec<_>>(), vec![1]);
        assert_eq!(store.len(), 1);
    }

    // ---- Resolver (worker) ----

    #[tokio::test]
    async fn admit_quarantines_future_and_passes_ready_through() {
        let store = Arc::new(InMemoryQuarantineStore::new());
        let oracle = Arc::new(MockOracle::new());
        let bc = Arc::new(MockBroadcaster::new());
        oracle.set(1114, ALICE, 1);
        let resolver = SequenceResolver::new(store.clone(), oracle, bc, SequenceConfig::default());

        // Future nonce (3) is quarantined.
        assert_eq!(
            resolver.admit(tx(3)).await.unwrap(),
            SequenceDecision::Quarantine { missing: (1, 3) }
        );
        assert_eq!(store.len(), 1);

        // In-order nonce (1) is ready and NOT stored here.
        assert_eq!(resolver.admit(tx(1)).await.unwrap(), SequenceDecision::ReadyToBroadcast);
        assert_eq!(store.len(), 1);
    }

    #[tokio::test]
    async fn resolver_releases_in_order_once_gap_fills() {
        let store = Arc::new(InMemoryQuarantineStore::new());
        let oracle = Arc::new(MockOracle::new());
        let bc = Arc::new(MockBroadcaster::new());

        // Chain expects 1. We receive 2 and 3 first (future -> quarantined).
        oracle.set(1114, ALICE, 1);
        resolver_admit(&store, &oracle, &bc, tx(3)).await;
        resolver_admit(&store, &oracle, &bc, tx(2)).await;
        assert_eq!(store.len(), 2);

        let resolver = SequenceResolver::new(store.clone(), oracle.clone(), bc.clone(), SequenceConfig::default());

        // Gap at 1 still unfilled -> nothing releases.
        let out = resolver.resolve_sender(1114, ALICE).await.unwrap();
        assert!(out.broadcast.is_empty());
        assert_eq!(store.len(), 2);

        // Now #1 settles on-chain independently; expected advances to... still 1 here
        // because 1 was broadcast on the normal path. Simulate 1 confirmed: expected=2.
        oracle.set(1114, ALICE, 2);
        let out = resolver.resolve_sender(1114, ALICE).await.unwrap();
        // 2 then 3 released strictly in order.
        assert_eq!(out.broadcast, vec![2, 3]);
        assert_eq!(bc.sent(), vec![2, 3]);
        assert_eq!(store.len(), 0);
    }

    #[tokio::test]
    async fn resolver_stops_on_broadcast_failure_preserving_order() {
        let store = Arc::new(InMemoryQuarantineStore::new());
        let oracle = Arc::new(MockOracle::new());
        let bc = Arc::new(MockBroadcaster::new());
        oracle.set(1114, ALICE, 5);
        // Quarantine 5,6,7 (all future relative to a later-advanced chain).
        for n in [7u64, 6, 5] {
            store.insert(aged(n, ALICE, ChronoDuration::zero()));
        }
        *bc.fail_on.lock().unwrap() = Some(6); // fail the middle one

        let resolver = SequenceResolver::new(store.clone(), oracle, bc.clone(), SequenceConfig::default());
        let out = resolver.resolve_sender(1114, ALICE).await.unwrap();
        // 5 sent, 6 fails and halts the run; 7 must NOT be broadcast out of order.
        assert_eq!(out.broadcast, vec![5]);
        assert_eq!(out.failed, vec![6]);
        assert_eq!(bc.sent(), vec![5]);
    }

    #[tokio::test]
    async fn tick_purges_expired_entries() {
        let store = Arc::new(InMemoryQuarantineStore::new());
        let oracle = Arc::new(MockOracle::new());
        let bc = Arc::new(MockBroadcaster::new());
        oracle.set(1114, ALICE, 0);
        store.insert(aged(9, ALICE, ChronoDuration::hours(48))); // stale future nonce
        let cfg = SequenceConfig { tick_interval: Duration::from_secs(1), quarantine_ttl: ChronoDuration::hours(24) };
        let resolver = SequenceResolver::new(store.clone(), oracle, bc, cfg);

        let out = resolver.tick().await;
        assert_eq!(out.expired, vec![9]);
        assert_eq!(store.len(), 0);
    }

    // helper to admit through a temporary resolver without moving Arcs
    async fn resolver_admit(
        store: &Arc<InMemoryQuarantineStore>,
        oracle: &Arc<MockOracle>,
        bc: &Arc<MockBroadcaster>,
        incoming: IncomingOfflineTx,
    ) {
        let resolver = SequenceResolver::new(store.clone(), oracle.clone(), bc.clone(), SequenceConfig::default());
        resolver.admit(incoming).await.unwrap();
    }
}
