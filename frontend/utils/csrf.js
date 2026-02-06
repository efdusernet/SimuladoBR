/**
 * CSRF Token Management Utility
 * Handles fetching and including CSRF tokens in API requests
 *
 * NOTE: This file may be included more than once (e.g., via dynamic HTML components).
 * It must be idempotent to avoid global redeclaration errors and double-wrapping fetch.
 */

(function initSimuladosCsrf(){
  if (window.__SIMULADOS_CSRF_V1_LOADED__) {
    return;
  }
  window.__SIMULADOS_CSRF_V1_LOADED__ = true;

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

    // Determine token endpoint: prefer same-origin, else use BACKEND_BASE
    let tokenUrl = '/api/csrf-token';
    try {
      const isHttpOrigin = /^https?:/i.test(window.location.origin);
      if (!isHttpOrigin) {
        const base = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || (window.location && window.location.origin) || 'http://app.localhost:3000';
        const u = new URL('/api/csrf-token', base);
        tokenUrl = u.toString();
      }
    } catch(e) { /* fallback keeps relative */ }

    this.fetching = fetch(tokenUrl, {
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

  // Expose constructor for debugging/advanced usage
  window.CSRFManager = window.CSRFManager || CSRFManager;

  // Global instance (preserve if already present)
  window.csrfManager = (window.csrfManager && typeof window.csrfManager.getToken === 'function')
    ? window.csrfManager
    : new CSRFManager();

/**
 * Enhanced fetch wrapper with automatic CSRF token injection
 */
  // Only wrap fetch once
  const originalFetch = window.__SIMULADOS_CSRF_ORIGINAL_FETCH__ || window.fetch;
  window.__SIMULADOS_CSRF_ORIGINAL_FETCH__ = originalFetch;

  window.fetch = async function(url, options = {}) {
  // Determine request target
  const urlObj = typeof url === 'string' ? new URL(url, window.location.origin) : url;
  const reqOrigin = urlObj.origin;
  const reqPathRaw = urlObj.pathname || '';
  // Normalize leading slashes so URLs like "//api/..." are still treated as API calls.
  const reqPath = reqPathRaw.replace(/^\/+/, '/');
  const isSameOrigin = reqOrigin === window.location.origin;
  const isAPI = reqPath.startsWith('/api/');

  // Build trusted backend origins from config; default to same-origin
  let trustedOrigins = new Set();
  try {
    const cfgBase = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || (window.location && window.location.origin) || 'http://app.localhost:3000';
    const baseUrl = new URL(cfgBase, window.location.origin);
    trustedOrigins.add(baseUrl.origin);
  } catch(e) {
    try { trustedOrigins.add(window.location.origin); } catch(_) {}
    trustedOrigins.add('http://localhost:3000');
  }

  const isTrustedBackend = trustedOrigins.has(reqOrigin);

  logger.info('[CSRF Wrapper] Intercepting fetch:', reqPath, 'isAPI:', isAPI, 'sameOrigin:', isSameOrigin, 'trustedBackend:', isTrustedBackend);

  // Inject CSRF for:
  // - Same-origin /api requests
  // - Trusted backend origin requests whose path starts with /api
  const shouldInjectCsrf = (isSameOrigin && isAPI) || (isTrustedBackend && reqPath.startsWith('/api'));
  if (shouldInjectCsrf) {
    try {
      options = await window.csrfManager.addTokenToFetch(url, options);
      // Ensure cookies are sent for backend validation
      options.credentials = options.credentials || 'include';
    } catch (err) {
      logger.warn('[CSRF Wrapper] Failed to add CSRF token:', err);
    }
  }

  const resp = await originalFetch.call(this, url, options);

  // Auto-recover from in-memory tokenStore resets or token expiry:
  // If the backend returns 403 with a CSRF_* code, refresh token and retry once.
  try {
    const method = String(options.method || 'GET').toUpperCase();
    const isSafe = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const alreadyRetried = options && options.__csrfRetried === true;

    if (shouldInjectCsrf && !isSafe && !alreadyRetried && resp && resp.status === 403) {
      let csrfCode = null;
      try {
        const data = await resp.clone().json();
        csrfCode = data && data.code ? String(data.code) : null;
      } catch (_) {
        // ignore non-JSON 403 bodies
      }

      if (csrfCode && csrfCode.startsWith('CSRF_')) {
        logger.warn('[CSRF Wrapper] 403 with CSRF code; refreshing token and retrying once:', csrfCode);
        const newToken = await window.csrfManager.refresh();

        const headers = new Headers(options.headers || {});
        if (newToken) headers.set('X-CSRF-Token', newToken);

        const retryOptions = {
          ...options,
          headers,
          credentials: options.credentials || 'include',
          __csrfRetried: true
        };
        return originalFetch.call(this, url, retryOptions);
      }
    }
  } catch (e) {
    // If refresh/retry fails, return the original response.
    try { logger.warn('[CSRF Wrapper] CSRF auto-retry failed:', e); } catch (_) {}
  }

  return resp;
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
})();
