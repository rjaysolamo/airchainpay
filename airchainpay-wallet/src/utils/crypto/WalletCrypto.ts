/**
 * WalletCrypto — pure, platform-independent cryptographic core used by
 * {@link WalletEncryption} to protect wallet credentials at rest.
 *
 * Security design
 * ---------------
 * - **Confidentiality + integrity** via **AES-256-GCM** (authenticated
 *   encryption with associated data). Any tampering with the ciphertext, IV,
 *   salt, or authentication tag — or an incorrect password — causes decryption
 *   to THROW. Callers therefore treat a thrown error as an authentication
 *   failure. This replaces the previous AES-CBC/PKCS7 scheme, which provided no
 *   integrity guarantee.
 * - **Key derivation** via **PBKDF2-HMAC-SHA-256** with an *explicitly* passed
 *   hash function and a high iteration count. The previous implementation used
 *   `crypto-js`'s `PBKDF2` default, which is HMAC-**SHA-1** — explicitly
 *   configuring SHA-256 removes that weakness.
 *
 * This module intentionally has **no** React Native / AsyncStorage
 * dependencies, so it can be unit-tested in a plain Node environment and reused
 * anywhere. Randomness comes from the platform CSPRNG
 * (`crypto.getRandomValues`), which is available in Node and in React Native
 * via the `react-native-get-random-values` polyfill / crypto shim.
 */
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  bytesToUtf8,
} from '@noble/hashes/utils';
import CryptoJS from 'crypto-js';

// ---- Parameters -------------------------------------------------------------

/** AES-256 key length in bytes. */
export const KEY_LENGTH_BYTES = 32;
/** GCM nonce/IV length in bytes (96-bit nonce is the GCM-recommended size). */
export const IV_LENGTH_BYTES = 12;
/** PBKDF2 salt length in bytes (256-bit). */
export const SALT_LENGTH_BYTES = 32;
/** GCM authentication tag length in bytes appended to the ciphertext. */
export const GCM_TAG_LENGTH_BYTES = 16;

/**
 * PBKDF2-SHA-256 iteration count. Chosen to balance mobile CPU cost against
 * brute-force resistance. It is stored per-record (see {@link WalletCryptoRecord})
 * so the value can be raised in the future without breaking existing data.
 */
export const DEFAULT_PBKDF2_ITERATIONS = 210_000;

/** Iteration count used by the legacy (v1) AES-CBC scheme. */
export const LEGACY_PBKDF2_ITERATIONS = 100_000;

/** Current authenticated-encryption record version. */
export const WALLET_CRYPTO_VERSION = 2 as const;

export const KDF_NAME = 'pbkdf2-sha256' as const;
export const CIPHER_NAME = 'aes-256-gcm' as const;

/**
 * Serialized, self-describing encrypted record (AES-256-GCM). Storing the
 * algorithm parameters alongside the ciphertext makes future migrations
 * (e.g. raising the iteration count or changing the KDF) straightforward.
 */
export interface WalletCryptoRecord {
  version: typeof WALLET_CRYPTO_VERSION;
  kdf: typeof KDF_NAME;
  cipher: typeof CIPHER_NAME;
  iterations: number;
  /** Hex-encoded PBKDF2 salt. */
  salt: string;
  /** Hex-encoded GCM IV/nonce. */
  iv: string;
  /** Hex-encoded `ciphertext || 16-byte auth tag`. */
  ciphertext: string;
}

// ---- Randomness -------------------------------------------------------------

/**
 * Cryptographically secure random bytes. Prefers the platform CSPRNG
 * (`crypto.getRandomValues`). Falls back to `crypto-js`'s CSPRNG-backed
 * `WordArray.random` (consistent with the rest of this codebase) and NEVER uses
 * `Math.random()`.
 */
export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('secureRandomBytes: length must be a positive integer');
  }
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    return g.crypto.getRandomValues(new Uint8Array(length));
  }
  const wordArray = CryptoJS.lib.WordArray.random(length);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

// ---- Key derivation ---------------------------------------------------------

/**
 * Derive a 256-bit key from a password + salt using PBKDF2-HMAC-SHA-256.
 * The hash function is passed explicitly; we never rely on a library default.
 *
 * @param password   User password (UTF-8).
 * @param salt        Per-record random salt.
 * @param iterations  PBKDF2 work factor.
 */
export async function deriveKeyPbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  if (!password) {
    throw new Error('deriveKeyPbkdf2Sha256: password must not be empty');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(
      'deriveKeyPbkdf2Sha256: iterations must be a positive integer',
    );
  }
  // `pbkdf2Async` yields to the event loop periodically, keeping the JS thread
  // responsive on-device even at high iteration counts.
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: KEY_LENGTH_BYTES,
  });
}

// ---- Authenticated encryption (AES-256-GCM) ---------------------------------

/**
 * Encrypt a UTF-8 string with AES-256-GCM using a freshly derived key, random
 * salt, and random IV. Returns a self-describing {@link WalletCryptoRecord}.
 */
export async function encryptToRecord(
  plaintext: string,
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<WalletCryptoRecord> {
  if (typeof plaintext !== 'string') {
    throw new Error('encryptToRecord: plaintext must be a string');
  }
  const salt = secureRandomBytes(SALT_LENGTH_BYTES);
  const iv = secureRandomBytes(IV_LENGTH_BYTES);
  const key = await deriveKeyPbkdf2Sha256(password, salt, iterations);

  const aead = gcm(key, iv);
  // noble appends the 16-byte GCM auth tag to the returned ciphertext.
  const ciphertext = aead.encrypt(utf8ToBytes(plaintext));

  return {
    version: WALLET_CRYPTO_VERSION,
    kdf: KDF_NAME,
    cipher: CIPHER_NAME,
    iterations,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
  };
}

/**
 * Decrypt a {@link WalletCryptoRecord}. Throws if the record is malformed, uses
 * an unsupported algorithm, or — crucially — if the GCM authentication tag does
 * not verify (wrong password or tampered data). A thrown error should be
 * treated by callers as an authentication failure.
 */
export async function decryptFromRecord(
  record: WalletCryptoRecord,
  password: string,
): Promise<string> {
  if (!record || typeof record !== 'object') {
    throw new Error('decryptFromRecord: missing record');
  }
  if (record.version !== WALLET_CRYPTO_VERSION) {
    throw new Error(
      `decryptFromRecord: unsupported record version "${String(record.version)}"`,
    );
  }
  if (record.cipher !== CIPHER_NAME) {
    throw new Error(
      `decryptFromRecord: unsupported cipher "${String(record.cipher)}"`,
    );
  }

  const salt = hexToBytes(record.salt);
  const iv = hexToBytes(record.iv);
  const ciphertext = hexToBytes(record.ciphertext);
  const iterations = record.iterations || DEFAULT_PBKDF2_ITERATIONS;

  const key = await deriveKeyPbkdf2Sha256(password, salt, iterations);
  const aead = gcm(key, iv);
  // Throws on authentication-tag mismatch.
  const plaintextBytes = aead.decrypt(ciphertext);
  return bytesToUtf8(plaintextBytes);
}

// ---- Legacy migration (AES-CBC + PBKDF2-SHA-1 via crypto-js) -----------------

/**
 * Decrypt a legacy (v1) record produced by the previous implementation, which
 * used `crypto-js` AES-CBC/PKCS7 with a PBKDF2 key derived using `crypto-js`
 * defaults (HMAC-**SHA-1**). Used ONLY to migrate existing wallet data forward
 * to AES-256-GCM. Throws on failure.
 *
 * NOTE: the original code passed the hex *string* form of the salt directly to
 * `CryptoJS.PBKDF2`, which interprets a string argument as UTF-8 (NOT as hex
 * bytes). We faithfully reproduce that behavior here so previously-stored data
 * decrypts correctly.
 */
export function decryptLegacyCbc(
  encryptedData: string,
  saltHex: string,
  ivHex: string,
  password: string,
  iterations: number = LEGACY_PBKDF2_ITERATIONS,
): string {
  const key = CryptoJS.PBKDF2(password, saltHex, {
    keySize: KEY_LENGTH_BYTES / 4, // 256-bit key expressed in 32-bit words (8)
    iterations,
  });
  const decrypted = CryptoJS.AES.decrypt(encryptedData, key, {
    iv: CryptoJS.enc.Hex.parse(ivHex),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  if (!text) {
    throw new Error(
      'decryptLegacyCbc: decryption failed (invalid password or corrupt data)',
    );
  }
  return text;
}
