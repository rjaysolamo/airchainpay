import * as Keychain from 'react-native-keychain';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './Logger';

/**
 * Secure Storage Service
 *
 * Implements hardware-backed storage using react-native-keychain with fallback
 * to expo-secure-store. Provides maximum security for sensitive wallet data
 * including private keys and seed phrases.
 *
 * SECURITY NOTE: This service intentionally does NOT mirror secrets into
 * AsyncStorage. AsyncStorage is an UNENCRYPTED key/value store; writing private
 * keys or seed phrases there (previously done as a "backup_<key>" copy) exposed
 * them in plaintext to anyone with filesystem/backup access. Keychain and
 * SecureStore already persist across app backgrounding, so the plaintext mirror
 * provided no real durability benefit while creating a critical vulnerability.
 *
 * For backward compatibility, reads will transparently MIGRATE any legacy
 * plaintext `backup_<key>` value into secure storage and then DELETE the
 * plaintext copy (self-healing cleanup for existing installs).
 */
export class SecureStorageService {
  private static instance: SecureStorageService;
  private keychainAvailable: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  private constructor() {
    this.initializationPromise = this.initializeKeychain();
  }

  public static getInstance(): SecureStorageService {
    if (!SecureStorageService.instance) {
      SecureStorageService.instance = new SecureStorageService();
    }
    return SecureStorageService.instance;
  }

  /**
   * Wait for initialization to complete
   */
  private async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Initialize keychain availability check
   */
  private async initializeKeychain(): Promise<void> {
    try {
      // Check if Keychain module is available and properly imported
      if (!Keychain) {
        this.keychainAvailable = false;
        logger.info('[SecureStorage] Keychain module not available, using SecureStore fallback');
        return;
      }

      // Check if the module has the required methods
      if (typeof Keychain.getSupportedBiometryType !== 'function') {
        this.keychainAvailable = false;
        logger.info('[SecureStorage] Keychain methods not available, using SecureStore fallback');
        return;
      }

      // Test if keychain is available by calling the method
      // Wrap in try-catch to handle any runtime errors
      try {
        const biometryType = await Keychain.getSupportedBiometryType();
        
        // Additional check: try to set a test value to verify keychain is working
        // Use a simpler test that doesn't require authentication
        const testKey = '__test_keychain_access__';
        const testValue = 'test_value_' + Date.now();
        
        try {
          await Keychain.setGenericPassword(testKey, testValue, {
            accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
            securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
          });
          
          // Try to retrieve the test value without authentication
          const credentials = await Keychain.getGenericPassword();
          
          // Clean up test value
          await Keychain.resetGenericPassword();
          
          if (credentials && credentials.password === testValue) {
            this.keychainAvailable = true;
            logger.info('[SecureStorage] Keychain is available and working properly');
          } else {
            this.keychainAvailable = false;
            logger.info('[SecureStorage] Keychain test failed, using SecureStore fallback');
          }
        } catch (testError) {
          this.keychainAvailable = false;
          logger.info('[SecureStorage] Keychain test failed, using SecureStore fallback:', testError);
        }
      } catch (keychainError) {
        // Keychain is not available on this device/platform
        this.keychainAvailable = false;
        logger.info('[SecureStorage] Keychain not supported on this device, using SecureStore fallback');
      }
    } catch (error) {
      this.keychainAvailable = false;
      logger.info('[SecureStorage] Keychain initialization failed, using SecureStore fallback');
    }
  }

  /**
   * Store sensitive data securely with backup
   * @param key - Storage key
   * @param value - Data to store
   */
  async setItem(key: string, value: string): Promise<void> {
    // Wait for initialization to complete
    await this.waitForInitialization();

    try {
      if (this.keychainAvailable && Keychain) {
        // Use hardware-backed keychain storage without authentication
        const keychainOptions = {
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
        };

        // For Keychain, we store all data in a single credential with JSON structure
        // First, get existing data
        let existingData: Record<string, string> = {};
        try {
          const credentials = await Keychain.getGenericPassword();
          if (credentials && credentials.password) {
            existingData = JSON.parse(credentials.password) as Record<string, string>;
          }
        } catch (parseError) {
          // If existing data is not JSON, start fresh
          logger.warn('[SecureStorage] Existing keychain data is not JSON, starting fresh');
        }

        // Update with new key-value pair
        existingData[key] = value;
        
        // Store the updated JSON
        await Keychain.setGenericPassword('wallet_data', JSON.stringify(existingData), keychainOptions);
        logger.info(`[SecureStorage] Stored ${key} in Keychain`);
      } else {
        // Fallback to SecureStore
        await SecureStore.setItemAsync(key, value);
        logger.info(`[SecureStorage] Stored ${key} in SecureStore (fallback)`);
      }

      // SECURITY: Do NOT mirror the value into AsyncStorage. AsyncStorage is
      // unencrypted; a plaintext copy of a private key / seed phrase there is a
      // critical vulnerability. Keychain/SecureStore already survive app
      // backgrounding and reinstalls (iOS Keychain), so no plaintext "backup"
      // is needed. Proactively remove any legacy plaintext copy for this key.
      try {
        await AsyncStorage.removeItem(`backup_${key}`);
      } catch (cleanupError) {
        logger.warn(`[SecureStorage] Failed to remove legacy plaintext backup for ${key}:`, cleanupError);
      }
    } catch (error) {
      logger.error(`[SecureStorage] Failed to store ${key}:`, error);
      
      // If keychain fails, try SecureStore as final fallback
      if (this.keychainAvailable) {
        try {
          await SecureStore.setItemAsync(key, value);
          logger.info(`[SecureStorage] Stored ${key} in SecureStore after Keychain failure`);
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to store ${key} in SecureStore fallback:`, fallbackError);
          throw new Error(`Failed to store sensitive data: ${fallbackError}`);
        }
      } else {
        throw new Error(`Failed to store sensitive data: ${error}`);
      }
    }
  }

  /**
   * Retrieve sensitive data securely with backup recovery
   * @param key - Storage key
   */
  async getItem(key: string): Promise<string | null> {
    // Wait for initialization to complete
    await this.waitForInitialization();

    try {
      if (this.keychainAvailable && Keychain) {
        // Use hardware-backed keychain storage without authentication
        // For Keychain, we retrieve the JSON data and extract the specific key
        const credentials = await Keychain.getGenericPassword();
        if (credentials && credentials.password) {
          try {
            const data = JSON.parse(credentials.password) as Record<string, string>;
            if (data[key]) {
              logger.info(`[SecureStorage] Retrieved ${key} from Keychain`);
              return data[key];
            }
          } catch (parseError) {
            logger.warn('[SecureStorage] Failed to parse keychain data:', parseError);
          }
        }
        
        // If no credentials found or key doesn't exist, try backup
        logger.info(`[SecureStorage] Key ${key} not found in Keychain, trying backup`);
      } else {
        // Fallback to SecureStore
        const value = await SecureStore.getItemAsync(key);
        if (value) {
          logger.info(`[SecureStorage] Retrieved ${key} from SecureStore (fallback)`);
          return value;
        }
        
        // If not found in SecureStore, try backup
        logger.info(`[SecureStorage] Key ${key} not found in SecureStore, trying backup`);
      }

      // Legacy migration path: older builds mirrored secrets into a plaintext
      // `backup_<key>` AsyncStorage entry. If present, migrate it into secure
      // storage and DELETE the plaintext copy so the secret no longer lives in
      // an unencrypted store.
      try {
        const legacyValue = await AsyncStorage.getItem(`backup_${key}`);
        if (legacyValue) {
          logger.warn(`[SecureStorage] Found legacy plaintext backup for ${key}; migrating to secure storage and deleting plaintext copy`);

          // Restore to primary (secure) storage. setItem() also removes the
          // plaintext backup, but we delete explicitly below to be certain.
          try {
            await this.setItem(key, legacyValue);
          } catch (restoreError) {
            logger.warn(`[SecureStorage] Failed to migrate ${key} to secure storage:`, restoreError);
          }

          try {
            await AsyncStorage.removeItem(`backup_${key}`);
          } catch (removeError) {
            logger.warn(`[SecureStorage] Failed to delete legacy plaintext backup for ${key}:`, removeError);
          }

          return legacyValue;
        }
      } catch (backupError) {
        logger.warn(`[SecureStorage] Failed to check legacy backup for ${key}:`, backupError);
      }
      
      return null;
    } catch (error) {
      logger.error(`[SecureStorage] Failed to retrieve ${key}:`, error);
      
      // Check if it's an authentication error and handle gracefully
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Authentication canceled') || 
          errorMessage.includes('code: 10') ||
          errorMessage.includes('User canceled')) {
        logger.info('[SecureStorage] Authentication canceled, trying SecureStore fallback');
        
        try {
          const value = await SecureStore.getItemAsync(key);
          logger.info(`[SecureStorage] Retrieved ${key} from SecureStore after authentication cancellation`);
          return value;
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to retrieve ${key} from SecureStore fallback:`, fallbackError);
          return null;
        }
      }
      
      // If keychain fails for other reasons, try SecureStore as final fallback
      if (this.keychainAvailable) {
        try {
          const value = await SecureStore.getItemAsync(key);
          logger.info(`[SecureStorage] Retrieved ${key} from SecureStore after Keychain failure`);
          return value;
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to retrieve ${key} from SecureStore fallback:`, fallbackError);
          return null;
        }
      } else {
        return null;
      }
    }
  }

  /**
   * Retrieve sensitive data with authentication (for private keys and seed phrases)
   * @param key - Storage key
   * @param options - Retrieval options
   */
  async getSensitiveItem(
    key: string,
    options: {
      useBiometrics?: boolean;
      promptMessage?: string;
    } = {}
  ): Promise<string | null> {
    const { useBiometrics = false, promptMessage = 'Authenticate to access secret' } = options;

    // Wait for initialization to complete
    await this.waitForInitialization();

    try {
      if (this.keychainAvailable && Keychain) {
        // Use hardware-backed keychain storage without authentication for now
        // For Keychain, we retrieve the JSON data and extract the specific key
        const credentials = await Keychain.getGenericPassword();
        if (credentials && credentials.password) {
          try {
            const data = JSON.parse(credentials.password) as Record<string, string>;
            if (data[key]) {
              logger.info(`[SecureStorage] Retrieved sensitive ${key} from Keychain`);
              return data[key];
            }
          } catch (parseError) {
            logger.warn('[SecureStorage] Failed to parse keychain data:', parseError);
          }
        }
        
        // If no credentials found or key doesn't exist, return null
        return null;
      } else {
        // Fallback to SecureStore
        const value = await SecureStore.getItemAsync(key);
        logger.info(`[SecureStorage] Retrieved sensitive ${key} from SecureStore (fallback)`);
        return value;
      }
    } catch (error) {
      logger.error(`[SecureStorage] Failed to retrieve sensitive ${key}:`, error);
      
      // Check if it's an authentication error and handle gracefully
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Authentication canceled') || 
          errorMessage.includes('code: 10') ||
          errorMessage.includes('User canceled')) {
        logger.info('[SecureStorage] Authentication canceled for sensitive item, trying SecureStore fallback');
        
        try {
          const value = await SecureStore.getItemAsync(key);
          logger.info(`[SecureStorage] Retrieved sensitive ${key} from SecureStore after authentication cancellation`);
          return value;
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to retrieve sensitive ${key} from SecureStore fallback:`, fallbackError);
          return null;
        }
      }
      
      // If keychain fails for other reasons, try SecureStore as final fallback
      if (this.keychainAvailable) {
        try {
          const value = await SecureStore.getItemAsync(key);
          logger.info(`[SecureStorage] Retrieved sensitive ${key} from SecureStore after Keychain failure`);
          return value;
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to retrieve sensitive ${key} from SecureStore fallback:`, fallbackError);
          return null;
        }
      } else {
        return null;
      }
    }
  }

  /**
   * Delete sensitive data
   * @param key - Storage key
   */
  async deleteItem(key: string): Promise<void> {
    // Wait for initialization to complete
    await this.waitForInitialization();

    try {
      if (this.keychainAvailable && Keychain) {
        // For Keychain, we need to delete from the JSON data
        const keychainOptions = {
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
        };
        
        const credentials = await Keychain.getGenericPassword();
        if (credentials && credentials.password) {
          try {
            const data = JSON.parse(credentials.password) as Record<string, string>;
            if (data[key]) {
              // Remove the key from the data
              delete data[key];
              
              // If no data left, remove the entire credential
              if (Object.keys(data).length === 0) {
                await Keychain.resetGenericPassword();
                logger.info(`[SecureStorage] Deleted all data from Keychain`);
              } else {
                // Store the updated data
                await Keychain.setGenericPassword('wallet_data', JSON.stringify(data), keychainOptions);
                logger.info(`[SecureStorage] Deleted ${key} from Keychain`);
              }
            } else {
              logger.info(`[SecureStorage] No item found with key ${key} in Keychain`);
            }
          } catch (parseError) {
            logger.warn('[SecureStorage] Failed to parse keychain data for deletion:', parseError);
          }
        } else {
          logger.info(`[SecureStorage] No keychain data found`);
        }
      } else {
        // Fallback to SecureStore
        await SecureStore.deleteItemAsync(key);
        logger.info(`[SecureStorage] Deleted ${key} from SecureStore (fallback)`);
      }

      // Also delete from AsyncStorage backup
      try {
        await AsyncStorage.removeItem(`backup_${key}`);
        logger.info(`[SecureStorage] Deleted ${key} from AsyncStorage backup`);
      } catch (backupError) {
        logger.warn(`[SecureStorage] Failed to delete ${key} from AsyncStorage backup:`, backupError);
      }
    } catch (error) {
      logger.error(`[SecureStorage] Failed to delete ${key}:`, error);
      
      // If keychain fails, try SecureStore as final fallback
      if (this.keychainAvailable) {
        try {
          await SecureStore.deleteItemAsync(key);
          logger.info(`[SecureStorage] Deleted ${key} from SecureStore after Keychain failure`);
        } catch (fallbackError) {
          logger.error(`[SecureStorage] Failed to delete ${key} from SecureStore fallback:`, fallbackError);
          throw new Error(`Failed to delete sensitive data: ${fallbackError}`);
        }
      } else {
        throw new Error(`Failed to delete sensitive data: ${error}`);
      }
    }
  }

  /**
   * Check if keychain is available
   */
  async isKeychainAvailable(): Promise<boolean> {
    await this.waitForInitialization();
    return this.keychainAvailable;
  }

  /**
   * Get supported biometric types
   */
  async getSupportedBiometryType(): Promise<Keychain.BIOMETRY_TYPE | null> {
    await this.waitForInitialization();
    
    try {
      if (this.keychainAvailable && Keychain) {
        return await Keychain.getSupportedBiometryType();
      }
      return null;
    } catch (error) {
      logger.warn('[SecureStorage] Failed to get supported biometry type:', error);
      return null;
    }
  }

  /**
   * Check if device has biometric hardware
   */
  async hasBiometricHardware(): Promise<boolean> {
    await this.waitForInitialization();
    
    try {
      if (this.keychainAvailable && Keychain) {
        const biometryType = await Keychain.getSupportedBiometryType();
        return biometryType !== null && biometryType !== Keychain.BIOMETRY_TYPE.TOUCH_ID;
      }
      return false;
    } catch (error) {
      logger.warn('[SecureStorage] Failed to check biometric hardware:', error);
      return false;
    }
  }

  /**
   * Check if biometrics are enrolled
   */
  async isBiometricsEnrolled(): Promise<boolean> {
    await this.waitForInitialization();
    
    try {
      if (this.keychainAvailable && Keychain) {
        const biometryType = await Keychain.getSupportedBiometryType();
        return biometryType !== null && biometryType !== Keychain.BIOMETRY_TYPE.TOUCH_ID;
      }
      return false;
    } catch (error) {
      logger.warn('[SecureStorage] Failed to check biometric enrollment:', error);
      return false;
    }
  }

  /**
   * Get security level information
   */
  async getSecurityLevel(): Promise<string> {
    await this.waitForInitialization();
    
    if (this.keychainAvailable) {
      return 'HARDWARE_BACKED';
    }
    return 'SOFTWARE_BACKED';
  }

  /**
   * Migrate data from SecureStore to Keychain
   * @param keys - Array of keys to migrate
   */
  async migrateFromSecureStore(keys: string[]): Promise<void> {
    await this.waitForInitialization();
    
    if (!this.keychainAvailable) {
      logger.warn('[SecureStorage] Cannot migrate: Keychain not available');
      return;
    }

    logger.info('[SecureStorage] Starting migration from SecureStore to Keychain');
    
    for (const key of keys) {
      try {
        const value = await SecureStore.getItemAsync(key);
        if (value) {
          await this.setItem(key, value);
          await SecureStore.deleteItemAsync(key);
          logger.info(`[SecureStorage] Migrated ${key} to Keychain`);
        }
      } catch (error) {
        logger.error(`[SecureStorage] Failed to migrate ${key}:`, error);
      }
    }
    
    logger.info('[SecureStorage] Migration completed');
  }

  /**
   * Clear all stored data
   */
  async clearAll(): Promise<void> {
    try {
      // Clear SecureStore data
      const keys = [
        'wallet_private_key',
        'wallet_seed_phrase',
        'temp_seed_phrase',
        'wallet_password',
        'backup_confirmed'
      ];
      
      for (const key of keys) {
        try {
          await SecureStore.deleteItemAsync(key);
        } catch (error) {
          // Ignore errors for keys that don't exist
        }
      }
      
      logger.info('[SecureStorage] Cleared all SecureStore data');
    } catch (error) {
      logger.error('[SecureStorage] Failed to clear all data:', error);
      throw error;
    }
  }

  /**
   * Migrate and purge any legacy plaintext `backup_<key>` entries.
   *
   * Older builds mirrored secrets into unencrypted AsyncStorage. This method
   * (invoked on app start) sweeps those legacy entries: each value is written
   * into secure storage (if not already present) and the plaintext copy is
   * deleted. It no longer "restores" anything on an ongoing basis because
   * secrets are never written to AsyncStorage anymore.
   *
   * @returns the number of legacy plaintext entries that were purged.
   */
  async migrateAndPurgeLegacyBackups(): Promise<number> {
    try {
      logger.info('[SecureStorage] Sweeping for legacy plaintext backups...');

      const keys = await AsyncStorage.getAllKeys();
      const backupKeys = keys.filter(key => key.startsWith('backup_'));

      if (backupKeys.length === 0) {
        logger.info('[SecureStorage] No legacy plaintext backups found');
        return 0;
      }

      logger.warn(`[SecureStorage] Found ${backupKeys.length} legacy plaintext backup item(s); migrating to secure storage and purging`);

      let purgedCount = 0;
      for (const backupKey of backupKeys) {
        try {
          const value = await AsyncStorage.getItem(backupKey);
          const originalKey = backupKey.replace('backup_', '');

          if (value) {
            // Only write to secure storage if it isn't already there, to avoid
            // overwriting a newer secret with a stale plaintext copy.
            const existing = await this.getItem(originalKey);
            if (!existing) {
              await this.setItem(originalKey, value);
              logger.info(`[SecureStorage] Migrated legacy ${originalKey} into secure storage`);
            }
          }

          await AsyncStorage.removeItem(backupKey);
          purgedCount++;
        } catch (purgeError) {
          logger.warn(`[SecureStorage] Failed to migrate/purge ${backupKey}:`, purgeError);
        }
      }

      logger.info(`[SecureStorage] Purged ${purgedCount} legacy plaintext backup item(s)`);
      return purgedCount;
    } catch (error) {
      logger.error('[SecureStorage] Failed to migrate/purge legacy backups:', error);
      return 0;
    }
  }

  /**
   * @deprecated Retained for backward compatibility. Secrets are no longer
   * mirrored to AsyncStorage; this now simply purges any legacy plaintext
   * backups. Returns true if at least one legacy entry was purged.
   */
  async checkAndRestoreBackup(): Promise<boolean> {
    const purged = await this.migrateAndPurgeLegacyBackups();
    return purged > 0;
  }

  /**
   * Clear all backup data
   */
  async clearBackup(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const backupKeys = keys.filter(key => key.startsWith('backup_'));
      
      for (const backupKey of backupKeys) {
        await AsyncStorage.removeItem(backupKey);
      }
      
      logger.info(`[SecureStorage] Cleared ${backupKeys.length} backup items`);
    } catch (error) {
      logger.error('[SecureStorage] Failed to clear backup:', error);
    }
  }

  /**
   * Regression check: storing a value must NOT leave a plaintext copy in
   * AsyncStorage. Verifies the value round-trips through secure storage while
   * confirming no `backup_<key>` plaintext entry is created.
   *
   * This is for development/testing purposes only.
   */
  async testNoPlaintextLeak(): Promise<boolean> {
    const testKey = 'test_backup_key';
    const testValue = 'test_backup_value_' + Date.now();
    try {
      logger.info('[SecureStorage] Testing that secrets are not leaked to AsyncStorage...');

      // Store test data
      await this.setItem(testKey, testValue);

      // Verify it round-trips through secure storage
      const primaryValue = await this.getItem(testKey);
      if (primaryValue !== testValue) {
        logger.error('[SecureStorage] Test failed: secure storage value mismatch');
        return false;
      }

      // CRITICAL: there must be NO plaintext copy in AsyncStorage
      const leaked = await AsyncStorage.getItem(`backup_${testKey}`);
      if (leaked !== null) {
        logger.error('[SecureStorage] Test failed: plaintext copy found in AsyncStorage (security regression)');
        return false;
      }

      logger.info('[SecureStorage] No-plaintext-leak test passed');
      return true;
    } catch (error) {
      logger.error('[SecureStorage] No-plaintext-leak test failed:', error);
      return false;
    } finally {
      // Always clean up test data
      try {
        await this.deleteItem(testKey);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// Export singleton instance
export const secureStorage = SecureStorageService.getInstance(); 