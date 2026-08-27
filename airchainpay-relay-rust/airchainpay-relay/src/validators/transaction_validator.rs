use crate::infrastructure::config::Config;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use ethers::types::{Transaction, U256};
use ethers::core::utils::rlp::{Rlp, Decodable};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

pub struct TransactionValidator {
    config: Arc<Config>,
    // For rate limiting (simple in-memory, per-process)
    rate_limit_state: Arc<Mutex<HashMap<String, (u64, u32)>>>, // (window_start, count)
}

impl TransactionValidator {
    pub fn new(config: Arc<Config>) -> Self {
        Self {
            config,
            rate_limit_state: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn validate_transaction(&self, signed_tx: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        };
        if let Err(e) = self.validate_transaction_format(signed_tx) {
            result.valid = false;
            result.errors.push(format!("Invalid transaction format: {e}"));
        }
        let chain_id = self.extract_chain_id_from_transaction(signed_tx).unwrap_or(self.config.chain_id);
        if let Err(e) = self.validate_chain_id(chain_id) {
            result.valid = false;
            result.errors.push(format!("Invalid chain ID: {e}"));
        }
        if let Err(e) = self.validate_transaction_size(signed_tx) {
            result.valid = false;
            result.errors.push(format!("Invalid transaction size: {e}"));
        }
        if let Err(e) = self.validate_hex_format(signed_tx) {
            result.valid = false;
            result.errors.push(format!("Invalid hex format: {e}"));
        }
        if let Err(e) = self.validate_signature(signed_tx).await {
            result.valid = false;
            result.errors.push(format!("Invalid signature: {e}"));
        }
        if let Err(e) = self.validate_gas_limits(signed_tx, chain_id) {
            result.valid = false;
            result.errors.push(format!("Invalid gas limits: {e}"));
        }
        if let Err(e) = self.validate_nonce(signed_tx, chain_id).await {
            result.warnings.push(format!("Nonce validation warning: {e}"));
        }
        if let Err(e) = self.validate_contract_interaction(signed_tx, chain_id) {
            result.valid = false;
            result.errors.push(format!("Invalid contract interaction: {e}"));
        }
        // Rate limit per client. We key by the recovered signer address so that
        // one abusive sender cannot exhaust the shared budget for everyone.
        // Falls back to a per-`to` address (or "unknown") if the signer cannot
        // be recovered.
        let rate_limit_key = self
            .decode_transaction(signed_tx)
            .ok()
            .and_then(|tx| tx.recover_from().ok().map(|addr| format!("{:#x}", addr)))
            .or_else(|| self.extract_to_address_from_transaction(signed_tx))
            .unwrap_or_else(|| "unknown".to_string());
        if let Err(e) = self.check_rate_limits(&rate_limit_key).await {
            result.valid = false;
            result.errors.push(format!("Rate limit exceeded: {e}"));
        }
        
        // Validate native transfer amount ONLY for plain native-value transfers.
        //
        // Contract interactions (ERC-20 transfers, executeMetaTransaction, pay(),
        // ...) carry calldata and — for token/meta flows — a zero native value.
        // Their amount is encoded in calldata and enforced by the target
        // contract, so range-checking `tx.value` is both meaningless and, as it
        // previously did, wrongly rejected EVERY zero-value token/meta transaction
        // as "amount too small". `validate_amount_for_tx` encapsulates this rule:
        // it accepts any contract call (calldata present) — including zero-value
        // ones — and only range-checks genuine native transfers.
        if let Ok(tx) = self.decode_transaction(signed_tx) {
            if let Err(e) = Self::validate_amount_for_tx(&tx) {
                result.valid = false;
                result.errors.push(format!("Invalid transaction amount: {e}"));
            }
        }
        
        Ok(result)
    }

    fn validate_transaction_format(&self, signed_tx: &str) -> Result<()> {
        if signed_tx.is_empty() {
            return Err(anyhow!("Transaction is empty"));
        }
        if !signed_tx.starts_with("0x") {
            return Err(anyhow!("Transaction must start with 0x"));
        }
        if signed_tx.len() < 66 {
            return Err(anyhow!("Transaction too short"));
        }
        Ok(())
    }

    fn validate_chain_id(&self, chain_id: u64) -> Result<()> {
        // Use supported_chains from config
        if !self.config.supported_chains.is_empty() && !self.config.supported_chains.contains_key(&chain_id) {
            return Err(anyhow!("Chain ID {chain_id} is not supported"));
        }
        Ok(())
    }

    fn validate_transaction_size(&self, signed_tx: &str) -> Result<()> {
        let size = signed_tx.len();
        // Optionally make max_size configurable
        let max_size = 128000;
        if size > max_size {
            return Err(anyhow!("Transaction too large: {} bytes (max: {})", size, max_size));
        }
        Ok(())
    }

    fn validate_hex_format(&self, signed_tx: &str) -> Result<()> {
        // Validate raw signed transaction hex, not a transaction hash
        let without_prefix = signed_tx
            .strip_prefix("0x")
            .ok_or_else(|| anyhow!("Transaction must start with 0x"))?;
        if without_prefix.is_empty() || without_prefix.len() % 2 != 0 {
            return Err(anyhow!("Hex payload must be non-empty and even-length"));
        }
        hex::decode(without_prefix)
            .map(|_| ())
            .map_err(|e| anyhow!("Invalid hex payload: {}", e))
    }

    async fn validate_signature(&self, signed_tx: &str) -> Result<()> {
        // Correct, envelope-aware signature validation.
        //
        // The previous implementation naively sliced the last 65 bytes as
        // `r||s||v` and only accepted `v ∈ {0,1,27,28}`. That is incorrect:
        //  - EIP-155 legacy transactions encode the chain id into `v`
        //    (`v = chainId*2 + 35/36`, e.g. 37/38 for chainId 1), so valid txs
        //    were rejected.
        //  - Typed transactions (EIP-2930 `0x01`, EIP-1559 `0x02`) are not raw
        //    RLP with a trailing 65-byte signature at all, so the slice was
        //    meaningless and could "pass" arbitrary blobs.
        //
        // Instead we decode the full transaction (ethers handles every envelope
        // type) and recover the sender from the signature. Successful recovery
        // proves the signature is well-formed and internally consistent with the
        // transaction contents.
        let tx = self.decode_transaction(signed_tx)?;

        let recovered = tx
            .recover_from()
            .map_err(|e| anyhow!("Failed to recover signer from signature: {}", e))?;

        if recovered.is_zero() {
            return Err(anyhow!("Recovered signer is the zero address"));
        }

        // If the decoded transaction carries a `from` (populated for many
        // encodings), ensure it matches the recovered signer.
        if !tx.from.is_zero() && tx.from != recovered {
            return Err(anyhow!(
                "Signature signer {:#x} does not match transaction 'from' {:#x}",
                recovered,
                tx.from
            ));
        }

        Ok(())
    }

    /// Helper to decode a signed transaction into ethers::types::Transaction
    fn decode_transaction(&self, signed_tx: &str) -> Result<Transaction> {
        let tx_bytes = hex::decode(signed_tx.trim_start_matches("0x"))
            .map_err(|e| anyhow!("Failed to decode hex: {}", e))?;
        let rlp = Rlp::new(&tx_bytes);
        Transaction::decode(&rlp).map_err(|e| anyhow!("Failed to decode transaction: {}", e))
    }

    fn extract_gas_limit_from_transaction(&self, signed_tx: &str) -> Option<u64> {
        self.decode_transaction(signed_tx).ok().map(|tx| tx.gas.as_u64())
    }

    fn extract_nonce_from_transaction(&self, signed_tx: &str) -> Option<u64> {
        self.decode_transaction(signed_tx).ok().map(|tx| tx.nonce.as_u64())
    }

    fn extract_to_address_from_transaction(&self, signed_tx: &str) -> Option<String> {
        self.decode_transaction(signed_tx).ok().and_then(|tx| tx.to.map(|to| format!("0x{:x}", to)))
    }

    fn validate_gas_limits(&self, signed_tx: &str, chain_id: u64) -> Result<()> {
        // Set chain-specific default max gas limits
        // Base (ETH): much lower, Core (non-ETH): higher
        let base_eth_chain_ids = [84532u64, 17000u64]; // Base Sepolia, Ethereum Holesky
        let core_chain_ids = [1114u64];     // Core Testnet
        let lisk_chain_ids = [4202u64];     // Lisk Sepolia

        let default_max_gas_limit: u64 = if base_eth_chain_ids.contains(&chain_id) {
            500_000 // Cheaper, lower limit for Base/ETH chains
        } else if core_chain_ids.contains(&chain_id) {
            2_000_000 // Reasonable limit for Core
        } else if lisk_chain_ids.contains(&chain_id) {
            1_500_000 // Moderate limit for Lisk
        } else {
            1_000_000 // Fallback for unknown chains
        };

        // Use per-chain config if set, otherwise use the above default
        let max_gas_limit = self.config.supported_chains.get(&chain_id)
            .and_then(|chain_cfg| chain_cfg.max_gas_limit)
            .unwrap_or(default_max_gas_limit);
        let gas_limit = self.extract_gas_limit_from_transaction(signed_tx)
            .ok_or_else(|| anyhow!("Failed to extract gas limit from transaction"))?;
        if gas_limit == 0 {
            return Err(anyhow!("Gas limit cannot be zero"));
        }
        if gas_limit > max_gas_limit {
            return Err(anyhow!("Gas limit {} exceeds max allowed {}", gas_limit, max_gas_limit));
        }
        Ok(())
    }

    async fn validate_nonce(&self, signed_tx: &str, _chain_id: u64) -> Result<()> {
        // Parse nonce from transaction
        let _nonce = self.extract_nonce_from_transaction(signed_tx)
            .ok_or_else(|| anyhow!("Failed to extract nonce from transaction"))?;
        // In a real implementation, compare with on-chain nonce
        // Note: Since nonce is u64, it cannot exceed u64::MAX by definition
        // This check is redundant and has been removed
        Ok(())
    }

    fn validate_contract_interaction(&self, signed_tx: &str, chain_id: u64) -> Result<()> {
        if let Some(chain_cfg) = self.config.supported_chains.get(&chain_id) {
            if !chain_cfg.contract_address.is_empty() {
                let to_addr = self.extract_to_address_from_transaction(signed_tx)
                    .ok_or_else(|| anyhow!("Failed to extract 'to' address from transaction"))?;
                
                // Validate the extracted address using ethereum validation
                use crate::infrastructure::blockchain::ethereum;
                if !ethereum::validate_ethereum_address(&to_addr) {
                    return Err(anyhow!("Invalid 'to' address format: {}", to_addr));
                }
                
                // Compare lowercase for safety
                if to_addr.to_lowercase() != chain_cfg.contract_address.to_lowercase() {
                    return Err(anyhow!("Transaction 'to' address {} does not match expected contract address {}", to_addr, chain_cfg.contract_address));
                }
            }
        }
        Ok(())
    }

    async fn check_rate_limits(&self, client_key: &str) -> Result<()> {
        // Use config.rate_limits
        let window_ms = self.config.rate_limits.window_ms;
        let max_requests = self.config.rate_limits.max_requests;
        if window_ms == 0 || max_requests == 0 {
            return Ok(()); // No rate limiting
        }
        // Per-client key (e.g. recovered signer address) so a single client
        // cannot consume the entire global budget. Note: this remains an
        // in-memory, per-process limiter — a shared store (e.g. Redis) is still
        // required for correctness across multiple relay instances.
        let key = client_key.to_string();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
        let mut state = self.rate_limit_state.lock().await;
        let (window_start, count) = state.get(&key).cloned().unwrap_or((now, 0));
        if now - window_start > window_ms {
            // Reset window
            state.insert(key, (now, 1));
            Ok(())
        } else if count < max_requests {
            state.insert(key, (window_start, count + 1));
            Ok(())
        } else {
            Err(anyhow!("Rate limit exceeded: {count} requests in {window_ms}ms"))
        }
    }

    fn extract_chain_id_from_transaction(&self, signed_tx: &str) -> Option<u64> {
        self.decode_transaction(signed_tx).ok().and_then(|tx| tx.chain_id).map(|id| id.as_u64()).or(Some(self.config.chain_id))
    }

    /// Single entry point deciding whether a decoded transaction's amount should
    /// be range-checked, and performing the check when appropriate.
    ///
    /// Payment model:
    ///  - **Contract interactions (calldata present)** — ERC-20 `transfer`,
    ///    `executeMetaTransaction`, `pay()`, ... — are ACCEPTED without native
    ///    amount validation. The transferred amount lives in calldata and is
    ///    enforced by the target contract, so a **zero native value is valid for
    ///    contract calls** (exactly the token/meta case that used to be rejected).
    ///  - A zero-value, no-calldata transaction transfers nothing natively, so
    ///    there is nothing to range-check → accepted.
    ///  - Only a *plain native-value transfer* (no calldata, non-zero value) is
    ///    range-checked against the dust/sanity bounds.
    fn validate_amount_for_tx(tx: &Transaction) -> Result<()> {
        if Self::is_native_value_transfer(tx) {
            Self::validate_native_value(tx.value)
        } else {
            Ok(())
        }
    }

    /// Returns true only for a *plain native-value transfer*: a transaction that
    /// carries no calldata (`input` empty) and moves a non-zero native `value`.
    ///
    /// Presence of calldata (`data`) is treated as a contract interaction; such
    /// transactions (including zero-value ones) skip native amount validation.
    /// This is the fix for the bug where every zero-native-value transaction
    /// (i.e. all token and meta-transactions) was rejected as "amount too small".
    fn is_native_value_transfer(tx: &Transaction) -> bool {
        tx.input.0.is_empty() && !tx.value.is_zero()
    }

    /// Range-check the native `value` (in wei) of a plain native transfer.
    ///
    /// `tx.value` is always denominated in wei, so bounds are computed in wei
    /// directly (the previous implementation mistakenly parsed the wei value as
    /// ether, which made legitimate transfers fail as "too large" and zero-value
    /// contract calls fail as "too small"). Bounds preserve the original intent:
    /// min 0.000001 ETH (dust guard) and max 1000 ETH (sanity cap).
    fn validate_native_value(value: U256) -> Result<()> {
        let wei_per_eth = U256::from(10u64).pow(U256::from(18u64));
        let min_wei = wei_per_eth / U256::from(1_000_000u64); // 0.000001 ETH
        let max_wei = wei_per_eth * U256::from(1_000u64);      // 1000 ETH

        if value < min_wei {
            return Err(anyhow!("Native amount too small: {} wei", value));
        }
        if value > max_wei {
            return Err(anyhow!("Native amount too large: {} wei", value));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ethers::types::Bytes;

    fn tx_with(value: U256, input: Vec<u8>) -> Transaction {
        let mut tx = Transaction::default();
        tx.value = value;
        tx.input = Bytes::from(input);
        tx
    }

    fn one_eth_wei() -> U256 {
        U256::from(10u64).pow(U256::from(18u64))
    }

    #[test]
    fn zero_value_contract_call_is_not_native_transfer() {
        // ERC-20 transfer / executeMetaTransaction: value == 0, has calldata.
        let tx = tx_with(U256::zero(), vec![0xa9, 0x05, 0x9c, 0xbb]); // transfer(...) selector
        assert!(!TransactionValidator::is_native_value_transfer(&tx));
    }

    #[test]
    fn zero_value_native_is_not_native_transfer() {
        // Nothing is being transferred natively; nothing to range-check.
        let tx = tx_with(U256::zero(), vec![]);
        assert!(!TransactionValidator::is_native_value_transfer(&tx));
    }

    #[test]
    fn contract_call_with_value_is_not_native_transfer() {
        // pay() with native value: amount enforced by contract, skip range-check.
        let tx = tx_with(one_eth_wei(), vec![0x12, 0x34]);
        assert!(!TransactionValidator::is_native_value_transfer(&tx));
    }

    #[test]
    fn positive_native_transfer_is_native_transfer() {
        let tx = tx_with(one_eth_wei(), vec![]);
        assert!(TransactionValidator::is_native_value_transfer(&tx));
    }

    #[test]
    fn native_value_within_bounds_ok() {
        assert!(TransactionValidator::validate_native_value(one_eth_wei()).is_ok());
    }

    #[test]
    fn native_value_too_large_rejected() {
        let too_large = one_eth_wei() * U256::from(2_000u64); // 2000 ETH
        assert!(TransactionValidator::validate_native_value(too_large).is_err());
    }

    #[test]
    fn native_value_dust_rejected() {
        // 1 wei is below the 0.000001 ETH dust guard.
        assert!(TransactionValidator::validate_native_value(U256::one()).is_err());
    }

    /// Regression test for the core bug: a zero-native-value token/meta
    /// transaction must be ACCEPTED by amount validation (previously it was
    /// rejected as "amount too small"). We assert `validate_amount_for_tx`
    /// returns Ok for both an ERC-20 `transfer` and an `executeMetaTransaction`.
    #[test]
    fn regression_zero_value_token_tx_is_accepted() {
        // ERC-20 transfer(address,uint256): 4-byte selector + 64 bytes args, value 0.
        let mut erc20 = vec![0xa9, 0x05, 0x9c, 0xbb];
        erc20.extend_from_slice(&[0u8; 64]);
        let token_tx = tx_with(U256::zero(), erc20);
        assert!(!TransactionValidator::is_native_value_transfer(&token_tx));
        assert!(
            TransactionValidator::validate_amount_for_tx(&token_tx).is_ok(),
            "zero-value ERC-20 transfer must be accepted"
        );

        // executeMetaTransaction(...)-style call: arbitrary selector, value 0.
        let mut meta = vec![0x0c, 0x53, 0xc5, 0x1c];
        meta.extend_from_slice(&[0u8; 128]);
        let meta_tx = tx_with(U256::zero(), meta);
        assert!(
            TransactionValidator::validate_amount_for_tx(&meta_tx).is_ok(),
            "zero-value meta-transaction must be accepted"
        );
    }

    /// A contract call that also carries native value (e.g. a payable `pay()`)
    /// is accepted without native range-checking — the amount is enforced by
    /// the contract, and `data` presence marks it as a contract interaction.
    #[test]
    fn value_bearing_contract_call_is_accepted() {
        let tx = tx_with(one_eth_wei(), vec![0x12, 0x34]);
        assert!(TransactionValidator::validate_amount_for_tx(&tx).is_ok());
    }

    /// A plain native transfer is still range-checked through the same entry
    /// point: in-bounds is accepted, dust and oversized are rejected.
    #[test]
    fn native_transfer_amount_still_enforced_via_entry_point() {
        let ok_tx = tx_with(one_eth_wei(), vec![]);
        assert!(TransactionValidator::validate_amount_for_tx(&ok_tx).is_ok());

        let dust_tx = tx_with(U256::one(), vec![]);
        assert!(TransactionValidator::validate_amount_for_tx(&dust_tx).is_err());

        let huge_tx = tx_with(one_eth_wei() * U256::from(2_000u64), vec![]);
        assert!(TransactionValidator::validate_amount_for_tx(&huge_tx).is_err());
    }
}
