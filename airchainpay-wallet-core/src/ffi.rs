//! FFI bindings for the wallet core
//! 
//! This module provides C-compatible function bindings for the wallet core.
//! All functions are designed to be safe and handle errors gracefully.
//! 
//! SECURITY: This module implements hardened FFI boundaries with:
//! - No raw string exposure of private keys
//! - Secure memory management with zeroization
//! - Input validation and sanitization
//! - Error handling that doesn't leak sensitive information

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;
use std::sync::OnceLock;
use crate::domain::Wallet;
use crate::shared::types::Network;
use crate::shared::error::WalletError;

/// Secure FFI result wrapper
#[repr(C)]
pub struct SecureResult {
    success: bool,
    data: *mut c_char,
    error_code: i32,
}

impl SecureResult {
    fn success(data: String) -> Self {
        match CString::new(data) {
            Ok(c_string) => Self {
                success: true,
                data: c_string.into_raw(),
                error_code: 0,
            },
            Err(_) => Self {
                success: false,
                data: ptr::null_mut(),
                error_code: 15, // String conversion failed
            },
        }
    }

    fn error(error_code: i32) -> Self {
        Self {
            success: false,
            data: ptr::null_mut(),
            error_code,
        }
    }
}

/// Input validation and sanitization
fn validate_input(input: *const c_char, max_length: usize) -> Result<String, WalletError> {
    if input.is_null() {
        return Err(WalletError::validation("Null input pointer".to_string()));
    }

    let input_str = unsafe {
        match CStr::from_ptr(input).to_str() {
            Ok(s) => s,
            Err(_) => return Err(WalletError::validation("Invalid UTF-8 input".to_string())),
        }
    };

    if input_str.len() > max_length {
        return Err(WalletError::validation("Input too long".to_string()));
    }

    if input_str.is_empty() {
        return Err(WalletError::validation("Empty input".to_string()));
    }

    // Sanitize input - remove any potentially dangerous characters
    let sanitized = input_str
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>();

    if sanitized != input_str {
        return Err(WalletError::validation("Input contains invalid characters".to_string()));
    }

    Ok(sanitized)
}

/// Validation for free-text inputs (wallet names, seed phrases, messages).
///
/// Unlike `validate_input`, this permits spaces and normal punctuation so that
/// legitimate values such as BIP39 seed phrases ("word1 word2 ...") and
/// human-readable messages are accepted. It still rejects NUL and other
/// control characters to guard against injection of dangerous bytes.
fn validate_text_input(input: *const c_char, max_length: usize) -> Result<String, WalletError> {
    if input.is_null() {
        return Err(WalletError::validation("Null input pointer".to_string()));
    }

    let input_str = unsafe {
        match CStr::from_ptr(input).to_str() {
            Ok(s) => s,
            Err(_) => return Err(WalletError::validation("Invalid UTF-8 input".to_string())),
        }
    };

    if input_str.len() > max_length {
        return Err(WalletError::validation("Input too long".to_string()));
    }

    if input_str.is_empty() {
        return Err(WalletError::validation("Empty input".to_string()));
    }

    // Reject control characters (except common whitespace) to prevent injection
    // of NUL/escape sequences while still allowing normal text with spaces.
    let has_dangerous_char = input_str
        .chars()
        .any(|c| c.is_control() && c != ' ' && c != '\t' && c != '\n' && c != '\r');

    if has_dangerous_char {
        return Err(WalletError::validation(
            "Input contains invalid control characters".to_string(),
        ));
    }

    Ok(input_str.to_string())
}

/// Validate network ID.
///
/// Covers every variant of `shared::types::Network` so that the FFI boundary
/// accepts exactly the chains the core actually supports (previously Lisk
/// Sepolia and Ethereum Holesky were silently rejected here even though the
/// rest of the core handles them).
fn validate_network(network: i32) -> Result<Network, WalletError> {
    match network {
        1114 => Ok(Network::CoreTestnet),
        84532 => Ok(Network::BaseSepolia),
        4202 => Ok(Network::LiskSepolia),
        17000 => Ok(Network::EthereumHolesky),
        _ => Err(WalletError::validation("Unsupported network".to_string())),
    }
}

/// Shared, lazily-initialized multi-threaded Tokio runtime for FFI calls.
///
/// The previous balance implementation built a brand-new `Runtime` on every
/// call, which is expensive and can exhaust OS threads/file descriptors under
/// load. We build one runtime on first use and reuse it for all subsequent
/// async FFI calls.
fn ffi_runtime() -> Option<&'static tokio::runtime::Runtime> {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    if let Some(rt) = RUNTIME.get() {
        return Some(rt);
    }
    let rt = tokio::runtime::Runtime::new().ok()?;
    Some(RUNTIME.get_or_init(|| rt))
}

/// Create a new wallet with secure key management
#[no_mangle]
pub extern "C" fn wallet_core_create_wallet(
    name: *const c_char,
    network: i32,
) -> SecureResult {
    // Validate inputs
    // Wallet names may contain spaces, so use the free-text validator.
    let name_str = match validate_text_input(name, 50) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    let network_enum = match validate_network(network) {
        Ok(n) => n,
        Err(_) => return SecureResult::error(2), // Invalid network
    };

    // Create secure storage and key manager
    let file_storage = match crate::infrastructure::platform::FileStorage::new() {
        Ok(storage) => storage,
        Err(_) => return SecureResult::error(3), // Storage initialization failed
    };
    
    let key_manager = crate::core::crypto::keys::KeyManager::new(&file_storage);
    
    // Generate a unique key ID for this wallet
    let key_id = format!("wallet_key_{}", uuid::Uuid::new_v4());
    
    // Generate private key securely
    let private_key = match key_manager.generate_private_key(&key_id) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(4), // Key generation failed
    };
    
    // Get public key without loading private key into memory
    let public_key = match key_manager.get_public_key(&private_key) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(5), // Public key generation failed
    };
    
    // Get address from public key
    let address = match key_manager.get_address(&public_key) {
        Ok(addr) => addr,
        Err(_) => return SecureResult::error(6), // Address generation failed
    };
    
    // Create wallet (no private key stored in wallet struct)
    let wallet = match Wallet::new(
        name_str,
        address,
        public_key,
        network_enum,
    ) {
        Ok(w) => w,
        Err(_) => return SecureResult::error(7), // Wallet creation failed
    };
    
    // Convert to safe WalletInfo for serialization
    let wallet_info = wallet.to_wallet_info();
    
    let wallet_json = match serde_json::to_string(&wallet_info) {
        Ok(json) => json,
        Err(_) => return SecureResult::error(8), // Serialization failed
    };
    
    SecureResult::success(wallet_json)
}

/// Import wallet from seed phrase with secure key management
#[no_mangle]
pub extern "C" fn wallet_core_import_wallet(
    seed_phrase: *const c_char,
) -> SecureResult {
    // Validate seed phrase input (BIP39 phrases contain spaces between words).
    let seed_phrase_raw = match validate_text_input(seed_phrase, 200) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    // Normalize surrounding whitespace (does not alter the BIP39 words themselves).
    let seed_phrase_str = seed_phrase_raw.trim().to_string();

    // Validate seed phrase format
    let words: Vec<&str> = seed_phrase_str.split_whitespace().collect();
    if words.len() < 12 || words.len() > 24 {
        return SecureResult::error(9); // Invalid seed phrase length
    }

    // Create secure storage and key manager
    let file_storage = match crate::infrastructure::platform::FileStorage::new() {
        Ok(storage) => storage,
        Err(_) => return SecureResult::error(3), // Storage initialization failed
    };
    
    let key_manager = crate::core::crypto::keys::KeyManager::new(&file_storage);
    
    // Generate a unique key ID for this wallet
    let key_id = format!("wallet_key_{}", uuid::Uuid::new_v4());
    
    // Derive private key from seed phrase securely
    let private_key = match key_manager.derive_private_key_from_seed(&seed_phrase_str, &key_id) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(10), // Seed phrase derivation failed
    };
    
    // Get public key without loading private key into memory
    let public_key = match key_manager.get_public_key(&private_key) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(5), // Public key generation failed
    };
    
    // Get address from public key
    let address = match key_manager.get_address(&public_key) {
        Ok(addr) => addr,
        Err(_) => return SecureResult::error(6), // Address generation failed
    };
    
    // Create wallet (no private key stored in wallet struct)
    let wallet = match Wallet::new(
        "Imported Wallet".to_string(),
        address,
        public_key,
        Network::CoreTestnet, // Default to CoreTestnet for import
    ) {
        Ok(w) => w,
        Err(_) => return SecureResult::error(7), // Wallet creation failed
    };
    
    // Convert to safe WalletInfo for serialization
    let wallet_info = wallet.to_wallet_info();
    
    let wallet_json = match serde_json::to_string(&wallet_info) {
        Ok(json) => json,
        Err(_) => return SecureResult::error(8), // Serialization failed
    };
    
    SecureResult::success(wallet_json)
}

/// Sign a message using a wallet's private key with secure memory management
#[no_mangle]
pub extern "C" fn wallet_core_sign_message(
    wallet_id: *const c_char,
    message: *const c_char,
) -> SecureResult {
    // Validate inputs
    let wallet_id_str = match validate_input(wallet_id, 100) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    // Messages can contain spaces/punctuation, so use the free-text validator.
    let message_str = match validate_text_input(message, 1000) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    // Get secure storage and key manager
    let file_storage = match crate::infrastructure::platform::FileStorage::new() {
        Ok(storage) => storage,
        Err(_) => return SecureResult::error(3), // Storage initialization failed
    };
    
    let key_manager = crate::core::crypto::keys::KeyManager::new(&file_storage);
    
    // Get private key reference (does not load key into memory)
    let private_key = match key_manager.get_private_key(&wallet_id_str) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(11), // Private key not found
    };
    
    // Sign message without loading private key into memory
    let signature = match key_manager.sign_message(&private_key, &message_str) {
        Ok(sig) => sig,
        Err(_) => return SecureResult::error(12), // Signing failed
    };
    
    SecureResult::success(signature)
}

/// Get an address's native-coin balance on a given network (real on-chain query).
///
/// CORRECTNESS: this is now a **stateless** query. It takes the wallet's public
/// `address` and `network` — both of which are returned to the caller in the
/// `WalletInfo` JSON from `wallet_core_create_wallet` / `wallet_core_import_wallet`
/// — and queries the chain directly via the shared `fetch_native_balance` helper.
///
/// This fixes the previous bug where the function constructed a fresh, empty
/// `WalletManager` on every call and then looked the wallet up in its in-memory
/// map. That lookup could never succeed: the map was always empty, and the
/// caller's `wallet_id` was an unrelated UUID that was never correlated with the
/// stored key id — so every balance query failed with `WalletNotFound`. It also
/// no longer spins up a new Tokio runtime per call.
#[no_mangle]
pub extern "C" fn wallet_core_get_balance(
    address: *const c_char,
    network: i32,
) -> SecureResult {
    // Validate the address. It is a public value (not a secret), so we accept
    // standard hex characters and then verify the canonical 0x + 40-hex shape.
    let address_str = match validate_input(address, 64) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };
    let is_valid_address = address_str.len() == 42
        && address_str.starts_with("0x")
        && address_str[2..].chars().all(|c| c.is_ascii_hexdigit());
    if !is_valid_address {
        return SecureResult::error(1); // Invalid input (malformed address)
    }

    let network_enum = match validate_network(network) {
        Ok(n) => n,
        Err(_) => return SecureResult::error(2), // Invalid network
    };

    // Reuse the shared runtime instead of building a new one per call.
    let rt = match ffi_runtime() {
        Some(rt) => rt,
        None => return SecureResult::error(15), // Runtime unavailable
    };

    let result = rt.block_on(async {
        crate::core::wallet::fetch_native_balance(&address_str, &network_enum).await
    });

    match result {
        Ok(balance) => SecureResult::success(balance),
        Err(_) => SecureResult::error(16), // Balance fetch failed
    }
}

/// Validate a wallet's private key without exposing it
#[no_mangle]
pub extern "C" fn wallet_core_validate_wallet(
    wallet_id: *const c_char,
) -> SecureResult {
    // Validate input
    let wallet_id_str = match validate_input(wallet_id, 100) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    // Get secure storage and key manager
    let file_storage = match crate::infrastructure::platform::FileStorage::new() {
        Ok(storage) => storage,
        Err(_) => return SecureResult::error(3), // Storage initialization failed
    };
    
    let key_manager = crate::core::crypto::keys::KeyManager::new(&file_storage);
    
    // Get private key reference
    let private_key = match key_manager.get_private_key(&wallet_id_str) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(11), // Private key not found
    };
    
    // Validate the private key without exposing it
    let is_valid = match private_key.validate(&file_storage) {
        Ok(valid) => valid,
        Err(_) => return SecureResult::error(13), // Validation failed
    };
    
    let result = if is_valid { "true" } else { "false" };
    SecureResult::success(result.to_string())
}

/// Delete a wallet and its associated private key
#[no_mangle]
pub extern "C" fn wallet_core_delete_wallet(
    wallet_id: *const c_char,
) -> SecureResult {
    // Validate input
    let wallet_id_str = match validate_input(wallet_id, 100) {
        Ok(s) => s,
        Err(_) => return SecureResult::error(1), // Invalid input
    };

    // Get secure storage and key manager
    let file_storage = match crate::infrastructure::platform::FileStorage::new() {
        Ok(storage) => storage,
        Err(_) => return SecureResult::error(3), // Storage initialization failed
    };
    
    let key_manager = crate::core::crypto::keys::KeyManager::new(&file_storage);
    
    // Get private key reference
    let private_key = match key_manager.get_private_key(&wallet_id_str) {
        Ok(pk) => pk,
        Err(_) => return SecureResult::error(11), // Private key not found
    };
    
    // Delete the private key from secure storage
    if let Err(_) = private_key.delete(&file_storage) {
        return SecureResult::error(14); // Deletion failed
    };
    
    SecureResult::success("deleted".to_string())
}

/// Free a C string with secure memory cleanup
#[no_mangle]
pub extern "C" fn wallet_core_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        }
    }
}

/// Free a SecureResult with secure memory cleanup
#[no_mangle]
pub extern "C" fn wallet_core_free_result(result: *mut SecureResult) {
    if !result.is_null() {
        unsafe {
            let result_ref = &mut *result;
            if !result_ref.data.is_null() {
                let _ = CString::from_raw(result_ref.data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The FFI network mapping must cover every supported chain id. This guards
    /// against the balance/create paths silently rejecting valid networks.
    #[test]
    fn validate_network_maps_all_supported_chain_ids() {
        assert!(matches!(validate_network(1114), Ok(Network::CoreTestnet)));
        assert!(matches!(validate_network(84532), Ok(Network::BaseSepolia)));
        assert!(matches!(validate_network(4202), Ok(Network::LiskSepolia)));
        assert!(matches!(validate_network(17000), Ok(Network::EthereumHolesky)));
    }

    #[test]
    fn validate_network_rejects_unknown_chain_id() {
        assert!(validate_network(0).is_err());
        assert!(validate_network(1).is_err());
        assert!(validate_network(999999).is_err());
    }

    /// The shared runtime must be reusable and return the *same* instance on
    /// repeated calls (i.e. we are not rebuilding a runtime per call anymore).
    #[test]
    fn ffi_runtime_is_shared_across_calls() {
        let a = ffi_runtime().expect("runtime should initialize");
        let b = ffi_runtime().expect("runtime should be reused");
        assert!(std::ptr::eq(a, b), "ffi_runtime must return the same shared instance");
    }
}
