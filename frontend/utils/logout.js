/**
 * Centralized Secure Logout Utility
 * Clears sensitive session data, calls backend logout, and redirects to login
 */

(function() {
  'use strict';

  /**
   * Perform complete secure logout
   * @param {Object} options - Logout options
   * @param {boolean} options.confirm - Show confirmation dialog (default: true)
   * @param {boolean} options.showNotification - Show logout notification (default: false)
   * @param {string} options.redirectUrl - URL to redirect after logout (default: '/login.html')
   */
  async function performLogout(options = {}) {
    const {
      confirm: shouldConfirm = true,
      showNotification = false,
      redirectUrl = '/login.html'
    } = options;

    // Ask for confirmation if needed
    if (shouldConfirm && !window.confirm('Deseja realmente sair?')) {
      return false;
    }

    // Call backend logout endpoint to clear httpOnly cookies
    try {
      const BACKEND_BASE = window.SIMULADOS_CONFIG?.BACKEND_BASE || 'http://localhost:3000';
      await fetch(`${BACKEND_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include' // Important: send cookies
      }).catch(() => {
        // Ignore network errors, still cleanup locally
      });
    } catch (e) {
      console.warn('[Logout] Failed to call backend logout:', e);
    }

    // Clear sessionStorage completely (contains temporary sensitive data)
    try {
      sessionStorage.clear();
    } catch (e) {
      console.warn('[Logout] Failed to clear sessionStorage:', e);
    }

    // Selectively clear sensitive keys from localStorage
    // Keep non-sensitive preferences like theme, settings, etc.
    try {
      const sensitiveKeys = [
        'sessionToken', 'token', 'jwt', 'authToken', 'accessToken', 'refreshToken',
        'userId', 'userEmail', 'userName', 'userRealName',
        'lockoutUntil'
      ];
      
      sensitiveKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // Also remove any keys that contain sensitive patterns
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.toLowerCase().includes('token') || 
                   key.toLowerCase().includes('password') ||
                   key.toLowerCase().includes('user') && key.toLowerCase().includes('email'))) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn('[Logout] Failed to clear localStorage:', e);
    }

    // Show notification if requested
    if (showNotification) {
      try {
        const notification = document.createElement('div');
        notification.textContent = 'Sessão encerrada';
        notification.style.cssText = 'position:fixed;top:14px;right:14px;background:#334155;color:#fff;padding:8px 12px;border-radius:6px;font-size:.75rem;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.25);';
        document.body.appendChild(notification);
        setTimeout(() => {
          try {
            notification.remove();
          } catch (e) {
            // ignore
          }
        }, 1200);
      } catch (e) {
        console.warn('Failed to show notification:', e);
      }
    }

    // Redirect to login
    setTimeout(() => {
      window.location.href = redirectUrl;
    }, showNotification ? 300 : 0);
  }

  // Export to global scope
  window.performLogout = performLogout;

  // Also create a simple alias
  window.doLogout = performLogout;
})();
