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
    // Avoid multiple simultaneous fetches
    if (this.fetching) {
      return this.fetching;
    }

    this.fetching = fetch('/api/csrf-token', {
      method: 'GET',
      credentials: 'include'
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch CSRF token');
        return res.json();
      })
      .then(data => {
        this.token = data.csrfToken;
        this.fetching = null;
        return this.token;
      })
      .catch(err => {
        console.error('CSRF token fetch failed:', err);
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
      this.token = cookieToken;
      return cookieToken;
    }

    // Fetch from server
    return this.fetchToken();
  }

  /**
   * Add CSRF token to fetch options
   */
  async addTokenToFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return options;
    }

    // Get token
    const token = await this.getToken();
    
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
  
  if (isSameOrigin && isAPI) {
    try {
      options = await window.csrfManager.addTokenToFetch(url, options);
    } catch (err) {
      console.warn('Failed to add CSRF token:', err);
    }
  }
  
  return originalFetch.call(this, url, options);
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.csrfManager.getToken().catch(() => {
      console.warn('Initial CSRF token fetch failed');
    });
  });
} else {
  window.csrfManager.getToken().catch(() => {
    console.warn('Initial CSRF token fetch failed');
  });
}

// Refresh token after login
window.addEventListener('user-login', () => {
  window.csrfManager.refresh().catch(() => {
    console.warn('CSRF token refresh after login failed');
  });
});

// Export for explicit usage
export { CSRFManager };
export default window.csrfManager;
