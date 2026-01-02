/**
 * Secure Storage Utilities
 * 
 * Provides secure storage mechanisms for sensitive data:
 * - Uses sessionStorage for temporary sensitive data
 * - Implements encryption for localStorage when needed
 * - Provides cleanup utilities
 * - Migrates away from storing tokens in localStorage
 */

// Keys that should NEVER be stored in localStorage
const FORBIDDEN_KEYS = ['token', 'sessionToken', 'jwt', 'authToken', 'accessToken', 'refreshToken'];

// Keys that contain sensitive data and should use sessionStorage
const SENSITIVE_KEYS = ['userEmail', 'userId', 'userName', 'userProfile'];

/**
 * Simple XOR encryption for localStorage data
 * Note: This is NOT cryptographically secure, just obfuscation
 * Real security comes from httpOnly cookies for tokens
 */
function simpleEncrypt(data, key = 'SimuladosBR_v1') {
  const text = JSON.stringify(data);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result); // Base64 encode
}

function simpleDecrypt(encrypted, key = 'SimuladosBR_v1') {
  try {
    const decoded = atob(encrypted);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return JSON.parse(result);
  } catch (e) {
    logger.warn('Failed to decrypt data:', e);
    return null;
  }
}

/**
 * Secure storage wrapper
 */
const SecureStorage = {
  /**
   * Set item with automatic storage selection
   * - Forbidden keys are rejected
   * - Sensitive keys go to sessionStorage
   * - Other keys go to localStorage with optional encryption
   */
  setItem(key, value, options = {}) {
    // Block forbidden keys
    if (FORBIDDEN_KEYS.some(k => key.toLowerCase().includes(k))) {
      logger.error(`[SecureStorage] Blocked attempt to store forbidden key: ${key}`);
      logger.warn('[SecureStorage] Tokens should be stored in httpOnly cookies only!');
      return false;
    }

    const { encrypt = false, temporary = false } = options;
    const storage = temporary || SENSITIVE_KEYS.includes(key) ? sessionStorage : localStorage;
    
    try {
      const dataToStore = encrypt ? simpleEncrypt(value) : JSON.stringify(value);
      storage.setItem(key, dataToStore);
      return true;
    } catch (e) {
      logger.error(`[SecureStorage] Failed to store ${key}:`, e);
      return false;
    }
  },

  /**
   * Get item with automatic decryption if needed
   */
  getItem(key, options = {}) {
    const { encrypted = false, temporary = false } = options;
    const storage = temporary || SENSITIVE_KEYS.includes(key) ? sessionStorage : localStorage;
    
    try {
      const data = storage.getItem(key);
      if (!data) return null;
      
      return encrypted ? simpleDecrypt(data) : JSON.parse(data);
    } catch (e) {
      logger.warn(`[SecureStorage] Failed to retrieve ${key}:`, e);
      return null;
    }
  },

  /**
   * Remove item from both storages
   */
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },

  /**
   * Clear all sensitive data on logout
   */
  clearSensitiveData() {
    logger.info('[SecureStorage] Clearing sensitive data...');
    
    // Clear sessionStorage completely
    sessionStorage.clear();
    
    // Remove specific sensitive keys from localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (SENSITIVE_KEYS.some(sk => key.includes(sk)) || 
          FORBIDDEN_KEYS.some(fk => key.toLowerCase().includes(fk))) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => {
      logger.info(`[SecureStorage] Removing: ${key}`);
      localStorage.removeItem(key);
    });
    
    return keysToRemove.length;
  },

  /**
   * Migrate old token storage to cookie-based auth
   */
  migrateFromLocalStorage() {
    const migratedKeys = [];
    
    // Find and remove any token-related keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (FORBIDDEN_KEYS.some(fk => key.toLowerCase().includes(fk))) {
        logger.warn(`[SecureStorage] Migrating away from localStorage: ${key}`);
        localStorage.removeItem(key);
        migratedKeys.push(key);
      }
    }
    
    if (migratedKeys.length > 0) {
      logger.info('[SecureStorage] Migration complete. Tokens now use httpOnly cookies.');
    }
    
    return migratedKeys;
  },

  /**
   * Get storage usage statistics
   */
  getUsageStats() {
    const stats = {
      localStorage: {
        used: 0,
        items: localStorage.length
      },
      sessionStorage: {
        used: 0,
        items: sessionStorage.length
      }
    };

    // Calculate localStorage usage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      stats.localStorage.used += (key.length + value.length) * 2; // Rough byte estimate
    }

    // Calculate sessionStorage usage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key);
      stats.sessionStorage.used += (key.length + value.length) * 2;
    }

    stats.localStorage.usedMB = (stats.localStorage.used / 1024 / 1024).toFixed(2);
    stats.sessionStorage.usedMB = (stats.sessionStorage.used / 1024 / 1024).toFixed(2);

    return stats;
  }
};

// Auto-migrate on load
if (typeof window !== 'undefined') {
  SecureStorage.migrateFromLocalStorage();
}

// Make available globally
if (typeof window !== 'undefined') {
  window.SecureStorage = SecureStorage;
}

export default SecureStorage;
