/**
 * CSRF Token Management Utility
 * Handles fetching and including CSRF tokens in API requests
 */

class CSRFManager {
  constructor() {
    this.token = null;
    this.fetching = null;
  }

  /**
   * Get CSRF token from cookie
   */
  getTokenFromCookie() {
    const match = document.cookie.match(/csrfToken=([^;]+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch fresh CSRF token from server
   */
  async fetchToken() {
    logger.info('[CSRF] Fetching new token from server');
    
    // Avoid multiple simultaneous fetches
    if (this.fetching) {
      logger.info('[CSRF] Already fetching, waiting for existing request');
      return this.fetching;
    }

    this.fetching = fetch('/api/csrf-token', {
      method: 'GET',
      credentials: 'include'
    })
      .then(res => {
        logger.info('[CSRF] Token fetch response:', res.status, res.ok);
        if (!res.ok) throw new Error('Failed to fetch CSRF token');
        return res.json();
      })
      .then(data => {
        logger.info('[CSRF] Token received:', data.csrfToken ? 'YES' : 'NO');
        this.token = data.csrfToken;
        this.fetching = null;
        return this.token;
      })
      .catch(err => {
        logger.error('[CSRF] Token fetch failed:', err);
        this.fetching = null;
        throw err;
      });

    return this.fetching;
  }

  /**
   * Get CSRF token (from cookie or fetch new)
   */
  async getToken() {
    // Try cookie first
    const cookieToken = this.getTokenFromCookie();
    if (cookieToken) {
      logger.info('[CSRF] Token found in cookie');
      this.token = cookieToken;
      return cookieToken;
    }

    // Fetch from server
    logger.info('[CSRF] No token in cookie, fetching from server');
    return this.fetchToken();
  }

  /**
   * Add CSRF token to fetch options
   */
  async addTokenToFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    
    logger.info('[CSRF] Adding token to request:', method, url);
    
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      logger.info('[CSRF] Skipping safe method:', method);
      return options;
    }

    // Get token
    const token = await this.getToken();
    logger.info('[CSRF] Adding token to headers:', token ? 'YES' : 'NO');
    
    // Add to headers
    options.headers = options.headers || {};
    options.headers['X-CSRF-Token'] = token;
    
    return options;
  }

  /**
   * Refresh token (useful after login)
   */
  async refresh() {
    this.token = null;
    return this.fetchToken();
  }
}

// Global instance
window.csrfManager = new CSRFManager();

/**
 * Enhanced fetch wrapper with automatic CSRF token injection
 */
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  // Only add CSRF for same-origin requests to /api/
  const urlObj = typeof url === 'string' ? new URL(url, window.location.origin) : url;
  const isSameOrigin = urlObj.origin === window.location.origin;
  const isAPI = urlObj.pathname.startsWith('/api/');
  
  logger.info('[CSRF Wrapper] Intercepting fetch:', urlObj.pathname, 'isAPI:', isAPI, 'isSameOrigin:', isSameOrigin);
  
  if (isSameOrigin && isAPI) {
    try {
      options = await window.csrfManager.addTokenToFetch(url, options);
    } catch (err) {
      logger.warn('[CSRF Wrapper] Failed to add CSRF token:', err);
    }
  }
  
  return originalFetch.call(this, url, options);
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    logger.info('[CSRF] Initializing on DOMContentLoaded');
    window.csrfManager.getToken().catch(() => {
      logger.warn('[CSRF] Initial CSRF token fetch failed');
    });
  });
} else {
  logger.info('[CSRF] Initializing immediately (DOM already loaded)');
  window.csrfManager.getToken().catch(() => {
    logger.warn('[CSRF] Initial CSRF token fetch failed');
  });
}

// Refresh token after login
window.addEventListener('user-login', () => {
  window.csrfManager.refresh().catch(() => {
    logger.warn('CSRF token refresh after login failed');
  });
});

// Available globally via window.csrfManager
// If you need to use as module, add type="module" to script tag
