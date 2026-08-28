import { logger } from '../Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PasswordHasher } from './PasswordHasher';
import {
  WalletCryptoRecord,
  encryptToRecord,
  decryptFromRecord,
  decryptLegacyCbc,
  DEFAULT_PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
  WALLET_CRYPTO_VERSION,
} from './WalletCrypto';

type CredentialType = 'seedphrase' | 'privatekey';

/**
 * Persisted, authenticated-encryption record (v2, AES-256-GCM). Extends the
 * pure {@link WalletCryptoRecord} with storage metadata.
 */
interface StoredWalletV2 extends WalletCryptoRecord {
  timestamp: number;
}

/**
 * Legacy persisted record (v1) produced by the previous AES-CBC/PKCS7
 * implementation. Retained for read + migration only; never written anymore.
 */
interface StoredWalletV1 {
  encryptedData: string;
  salt: string;
  iv: string;
  version?: number; // 1 or undefined
  timestamp: number;
}

interface PasswordAttempt {
  timestamp: number;
  count: number;
}

/**
 * WalletEncryption
 * ----------------
 * Encrypts/decrypts wallet credentials (seed phrase or private key) at rest in
 * AsyncStorage.
 *
 * Cryptography (see {@link WalletCrypto}):
 * - **AES-256-GCM** authenticated encryption. An incorrect password or any
 *   tampering with stored data causes decryption to fail loudly instead of
 *   silently returning garbage — which is what the previous AES-CBC scheme did.
 * - **PBKDF2-HMAC-SHA-256** (explicit hasher, high iteration count) for turning
 *   the password into a key.
 *
 * Backwards compatibility: records written by the previous version (AES-CBC +
 * PBKDF2-SHA-1, `version: 1`) are still readable. On the first successful
 * unlock they are transparently re-encrypted to the AES-256-GCM format
 * (`version: 2`), so existing wallets keep working while upgrading their
 * data-at-rest protection.
 */
export class WalletEncryption {
  private static readonly PBKDF2_ITERATIONS = DEFAULT_PBKDF2_ITERATIONS;
  private static readonly STORAGE_KEY_PREFIX = '@wallet_credentials_';
  private static readonly ATTEMPTS_KEY = '@password_attempts';
  private static readonly MAX_PASSWORD_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION = 300000;

  private static async getPasswordAttempts(): Promise<PasswordAttempt> {
    try {
      const attempts = await AsyncStorage.getItem(this.ATTEMPTS_KEY);
      return attempts ? JSON.parse(attempts) : { timestamp: 0, count: 0 };
    } catch {
      return { timestamp: 0, count: 0 };
    }
  }

  private static async updatePasswordAttempts(success: boolean): Promise<void> {
    try {
      const now = Date.now();
      const attempts = await this.getPasswordAttempts();

      if (now - attempts.timestamp > this.LOCKOUT_DURATION) {
        await AsyncStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify({
          timestamp: now,
          count: success ? 0 : 1
        }));
        return;
      }

      const newCount = success ? 0 : attempts.count + 1;
      await AsyncStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify({
        timestamp: now,
        count: newCount
      }));

      if (newCount >= this.MAX_PASSWORD_ATTEMPTS) {
        throw new Error(`Too many failed attempts. Please try again in ${Math.ceil(this.LOCKOUT_DURATION / 60000)} minutes.`);
      }
    } catch (error) {
      logger.error('[WalletEncryption] Error updating password attempts:', error);
      throw error;
    }
  }

  /**
   * Wrap credentials in a small, self-verifying JSON envelope before
   * encryption. Because the payload is authenticated by GCM, a successful
   * decrypt + `JSON.parse` is an additional structural integrity check.
   */
  private static wrapCredentials(credentials: string, type: CredentialType): string {
    return JSON.stringify({ credentials, type, timestamp: Date.now() });
  }

  private static unwrapCredentials(plaintext: string): string {
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed.credentials !== 'string' || !parsed.credentials) {
      throw new Error('Decrypted payload did not contain credentials');
    }
    return parsed.credentials;
  }

  /**
   * Encrypt wallet credentials (seed phrase or private key) with AES-256-GCM
   * and persist them.
   */
  static async encryptCredentials(
    credentials: string,
    password: string,
    type: CredentialType
  ): Promise<void> {
    try {
      const record = await encryptToRecord(
        this.wrapCredentials(credentials, type),
        password,
        this.PBKDF2_ITERATIONS
      );

      const stored: StoredWalletV2 = { ...record, timestamp: Date.now() };

      await AsyncStorage.setItem(
        this.STORAGE_KEY_PREFIX + type,
        JSON.stringify(stored)
      );
    } catch (error) {
      logger.error('[WalletEncryption] Error encrypting credentials:', error);
      throw new Error('Failed to encrypt wallet credentials');
    }
  }

  /**
   * Decrypt and retrieve wallet credentials.
   *
   * Handles both the current AES-256-GCM (v2) format and the legacy AES-CBC
   * (v1) format. Legacy records are migrated to v2 on first successful unlock.
   */
  static async retrieveCredentials(
    password: string,
    type: CredentialType
  ): Promise<string> {
    // Enforce lockout window before attempting any (expensive) key derivation.
    const attempts = await this.getPasswordAttempts();
    const now = Date.now();
    if (attempts.count >= this.MAX_PASSWORD_ATTEMPTS &&
        now - attempts.timestamp < this.LOCKOUT_DURATION) {
      const remainingTime = Math.ceil((this.LOCKOUT_DURATION - (now - attempts.timestamp)) / 60000);
      throw new Error(`Too many failed attempts. Please try again in ${remainingTime} minutes.`);
    }

    const storedData = await AsyncStorage.getItem(this.STORAGE_KEY_PREFIX + type);
    if (!storedData) {
      throw new Error('No stored credentials found');
    }

    let parsed: StoredWalletV2 | StoredWalletV1;
    try {
      parsed = JSON.parse(storedData);
    } catch (error) {
      logger.error('[WalletEncryption] Stored credential record is corrupt:', error);
      throw new Error('Stored credentials are corrupted');
    }

    const version = typeof (parsed as StoredWalletV2).version === 'number'
      ? (parsed as StoredWalletV2).version
      : 1;

    let plaintextWrapper: string;
    let needsMigration = false;

    try {
      if (version >= WALLET_CRYPTO_VERSION) {
        // Current AES-256-GCM format. Authentication failure => throws.
        plaintextWrapper = await decryptFromRecord(parsed as StoredWalletV2, password);
      } else {
        // Legacy AES-CBC (v1) format. Decrypt then flag for migration.
        const v1 = parsed as StoredWalletV1;
        plaintextWrapper = decryptLegacyCbc(
          v1.encryptedData,
          v1.salt,
          v1.iv,
          password,
          LEGACY_PBKDF2_ITERATIONS
        );
        needsMigration = true;
      }
    } catch (error) {
      // Wrong password or tampered/corrupt data — count as a failed attempt.
      await this.updatePasswordAttempts(false);
      logger.warn('[WalletEncryption] Credential decryption failed');
      throw new Error('Invalid password');
    }

    let credentials: string;
    try {
      credentials = this.unwrapCredentials(plaintextWrapper);
    } catch (error) {
      await this.updatePasswordAttempts(false);
      throw new Error('Invalid password');
    }

    await this.updatePasswordAttempts(true);

    // Transparently upgrade legacy records to AES-256-GCM now that we hold the
    // plaintext and a verified password. Best-effort: a failure here does not
    // prevent returning the credentials; migration is retried on next unlock.
    if (needsMigration) {
      try {
        await this.encryptCredentials(credentials, password, type);
        logger.info(`[WalletEncryption] Migrated ${type} credentials to AES-256-GCM`);
      } catch (error) {
        logger.warn('[WalletEncryption] Failed to migrate legacy credentials to AES-256-GCM; will retry on next unlock:', error);
      }
    }

    return credentials;
  }

  /**
   * Change wallet encryption password. Re-encrypts every stored credential type
   * under the new password (always producing AES-256-GCM records).
   */
  static async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    try {
      const types: CredentialType[] = ['seedphrase', 'privatekey'];
      const storedCredentials: Partial<Record<CredentialType, string>> = {};

      for (const type of types) {
        try {
          const credentials = await this.retrieveCredentials(currentPassword, type);
          if (credentials) {
            storedCredentials[type] = credentials;
          }
        } catch (error) {
          continue;
        }
      }

      if (Object.keys(storedCredentials).length === 0) {
        throw new Error('Invalid current password');
      }

      for (const [type, credentials] of Object.entries(storedCredentials)) {
        await this.encryptCredentials(
          credentials as string,
          newPassword,
          type as CredentialType
        );
      }

      await AsyncStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify({
        timestamp: Date.now(),
        count: 0
      }));
    } catch (error) {
      logger.error('[WalletEncryption] Error changing password:', error);
      throw new Error('Failed to change password');
    }
  }

  /**
   * Verify if a password is correct without revealing credentials. Attempts to
   * decrypt stored credentials; with AES-256-GCM this is a cryptographically
   * sound check (a wrong password fails the authentication tag).
   */
  static async verifyPassword(password: string): Promise<boolean> {
    try {
      const attempts = await this.getPasswordAttempts();
      const now = Date.now();

      if (attempts.count >= this.MAX_PASSWORD_ATTEMPTS &&
          now - attempts.timestamp < this.LOCKOUT_DURATION) {
        return false;
      }

      const types: CredentialType[] = ['seedphrase', 'privatekey'];

      for (const type of types) {
        try {
          const credentials = await this.retrieveCredentials(password, type);
          if (credentials) {
            return true;
          }
        } catch (error) {
          // 'No stored credentials found' for this type, or a wrong password.
          // retrieveCredentials already records failed attempts where relevant.
          continue;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify a password using the standalone {@link PasswordHasher} system.
   * Used for wallet password verification against a stored password hash
   * (independent of the encrypted-credential flow above).
   */
  static async verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
    try {
      // Reject legacy plain-text passwords.
      if (!PasswordHasher.isSecureHash(storedHash)) {
        logger.warn('[WalletEncryption] Legacy plain text password detected');
        return false;
      }

      const isValid = PasswordHasher.verifyPassword(password, storedHash);

      if (isValid) {
        logger.info('[WalletEncryption] Password verification successful');
      } else {
        logger.warn('[WalletEncryption] Password verification failed');
      }

      return isValid;
    } catch (error) {
      logger.error('[WalletEncryption] Failed to verify password hash:', error);
      return false;
    }
  }
}
