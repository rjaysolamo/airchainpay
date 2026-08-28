import CryptoJS from 'crypto-js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import {
  encryptToRecord,
  decryptFromRecord,
  deriveKeyPbkdf2Sha256,
  decryptLegacyCbc,
  secureRandomBytes,
  WALLET_CRYPTO_VERSION,
  KDF_NAME,
  CIPHER_NAME,
  DEFAULT_PBKDF2_ITERATIONS,
  IV_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
  GCM_TAG_LENGTH_BYTES,
  KEY_LENGTH_BYTES,
  type WalletCryptoRecord,
} from '../WalletCrypto';

// Use a low iteration count for the majority of tests so the suite stays fast;
// the parameter is stored per-record and honored on decrypt.
const FAST_ITERS = 1000;
const PASSWORD = 'Str0ng!Passw0rd';
const SECRET =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('WalletCrypto — AES-256-GCM authenticated encryption', () => {
  it('encrypts into a self-describing v2 record (GCM + PBKDF2-SHA256)', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD); // default iterations
    expect(rec.version).toBe(WALLET_CRYPTO_VERSION);
    expect(rec.kdf).toBe(KDF_NAME);
    expect(rec.cipher).toBe(CIPHER_NAME);
    expect(rec.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(hexToBytes(rec.salt).length).toBe(SALT_LENGTH_BYTES);
    expect(hexToBytes(rec.iv).length).toBe(IV_LENGTH_BYTES);
    // ciphertext = encrypted bytes + 16-byte GCM tag
    expect(hexToBytes(rec.ciphertext).length).toBeGreaterThanOrEqual(
      GCM_TAG_LENGTH_BYTES,
    );
    // The plaintext must not appear anywhere in the stored ciphertext.
    const secretHex = Buffer.from(SECRET, 'utf8').toString('hex');
    expect(rec.ciphertext).not.toContain(secretHex);
  });

  it('round-trips: decrypt returns the exact original plaintext', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    const out = await decryptFromRecord(rec, PASSWORD);
    expect(out).toBe(SECRET);
  });

  it('handles empty and unicode plaintext', async () => {
    for (const text of ['', '🔐 seed café — 日本語 — ключ']) {
      const rec = await encryptToRecord(text, PASSWORD, FAST_ITERS);
      expect(await decryptFromRecord(rec, PASSWORD)).toBe(text);
    }
  });

  it('produces unique salt/iv/ciphertext per encryption (semantic security)', async () => {
    const a = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    const b = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  // ---- Authentication-failure tests --------------------------------------

  it('fails authentication with a wrong password', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    await expect(decryptFromRecord(rec, 'not-the-password')).rejects.toThrow();
  });

  it('fails authentication when the ciphertext is tampered with', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    const bytes = hexToBytes(rec.ciphertext);
    bytes[0] ^= 0xff; // flip a byte in the ciphertext body
    const tampered: WalletCryptoRecord = { ...rec, ciphertext: bytesToHex(bytes) };
    await expect(decryptFromRecord(tampered, PASSWORD)).rejects.toThrow();
  });

  it('fails authentication when the GCM tag is tampered with', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    const bytes = hexToBytes(rec.ciphertext);
    bytes[bytes.length - 1] ^= 0x01; // flip a bit in the trailing auth tag
    const tampered: WalletCryptoRecord = { ...rec, ciphertext: bytesToHex(bytes) };
    await expect(decryptFromRecord(tampered, PASSWORD)).rejects.toThrow();
  });

  it('fails authentication when the IV is tampered with', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    const iv = hexToBytes(rec.iv);
    iv[0] ^= 0xff;
    const tampered: WalletCryptoRecord = { ...rec, iv: bytesToHex(iv) };
    await expect(decryptFromRecord(tampered, PASSWORD)).rejects.toThrow();
  });

  it('rejects unsupported versions and ciphers', async () => {
    const rec = await encryptToRecord(SECRET, PASSWORD, FAST_ITERS);
    await expect(
      decryptFromRecord({ ...rec, version: 1 as never }, PASSWORD),
    ).rejects.toThrow(/unsupported record version/);
    await expect(
      decryptFromRecord({ ...rec, cipher: 'aes-256-cbc' as never }, PASSWORD),
    ).rejects.toThrow(/unsupported cipher/);
  });
});

describe('WalletCrypto — PBKDF2-HMAC-SHA-256 key derivation', () => {
  it('derives a 32-byte key deterministically for identical inputs', async () => {
    const salt = secureRandomBytes(SALT_LENGTH_BYTES);
    const k1 = await deriveKeyPbkdf2Sha256('pw', salt, FAST_ITERS);
    const k2 = await deriveKeyPbkdf2Sha256('pw', salt, FAST_ITERS);
    expect(k1.length).toBe(KEY_LENGTH_BYTES);
    expect(bytesToHex(k1)).toBe(bytesToHex(k2));
  });

  it('derives different keys for different salts', async () => {
    const s1 = secureRandomBytes(SALT_LENGTH_BYTES);
    const s2 = secureRandomBytes(SALT_LENGTH_BYTES);
    const k1 = await deriveKeyPbkdf2Sha256('pw', s1, FAST_ITERS);
    const k2 = await deriveKeyPbkdf2Sha256('pw', s2, FAST_ITERS);
    expect(bytesToHex(k1)).not.toBe(bytesToHex(k2));
  });

  it('matches the published PBKDF2-HMAC-SHA256 test vector (c=1)', async () => {
    // RFC-style vector: password "password", salt "salt", c=1, dkLen=32
    // => 120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b
    const key = await deriveKeyPbkdf2Sha256(
      'password',
      new TextEncoder().encode('salt'),
      1,
    );
    expect(bytesToHex(key)).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
  });

  it('rejects invalid parameters', async () => {
    await expect(
      deriveKeyPbkdf2Sha256('', secureRandomBytes(16), FAST_ITERS),
    ).rejects.toThrow();
    await expect(
      deriveKeyPbkdf2Sha256('pw', secureRandomBytes(16), 0),
    ).rejects.toThrow();
  });
});

describe('WalletCrypto — legacy v1 (AES-CBC / PBKDF2-SHA-1) migration path', () => {
  // Reproduce EXACTLY how the previous WalletEncryption implementation stored
  // data, so we prove old wallet data remains decryptable during migration.
  function legacyEncrypt(plaintext: string, password: string) {
    const salt = CryptoJS.lib.WordArray.random(32).toString();
    const iv = CryptoJS.lib.WordArray.random(16).toString();
    const key = CryptoJS.PBKDF2(password, salt, {
      keySize: 256 / 32,
      iterations: 100000,
    });
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv: CryptoJS.enc.Hex.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return { encryptedData: encrypted.toString(), salt, iv };
  }

  it('decrypts data produced by the old AES-CBC scheme', () => {
    const wrapper = JSON.stringify({
      credentials: '0xabc123def456',
      entropy: 'x',
      timestamp: 1,
    });
    const v1 = legacyEncrypt(wrapper, 'legacy-pass');
    const out = decryptLegacyCbc(v1.encryptedData, v1.salt, v1.iv, 'legacy-pass');
    expect(JSON.parse(out).credentials).toBe('0xabc123def456');
  });

  it('throws when the legacy password is wrong', () => {
    const v1 = legacyEncrypt('sensitive', 'right-pass');
    expect(() =>
      decryptLegacyCbc(v1.encryptedData, v1.salt, v1.iv, 'wrong-pass'),
    ).toThrow();
  });
});
