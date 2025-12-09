/**
 * Centralized Logout Utility
 * Clears all session data and redirects to login
 */

(function() {
  'use strict';

  /**
   * Perform complete logout
   * @param {Object} options - Logout options
   * @param {boolean} options.confirm - Show confirmation dialog (default: true)
   * @param {boolean} options.showNotification - Show logout notification (default: false)
   * @param {string} options.redirectUrl - URL to redirect after logout (default: '/login.html')
   */
  function performLogout(options = {}) {
    const {
      confirm: shouldConfirm = true,
      showNotification = false,
      redirectUrl = '/login.html'
    } = options;

    // Ask for confirmation if needed
    if (shouldConfirm && !window.confirm('Deseja realmente sair?')) {
      return;
    }

    // Clear all storage
    try {
      localStorage.clear();
    } catch (e) {
      console.warn('Failed to clear localStorage:', e);
    }

    try {
      sessionStorage.clear();
    } catch (e) {
      console.warn('Failed to clear sessionStorage:', e);
    }

    // Clear cookies
    try {
      document.cookie = 'sessionToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;';
    } catch (e) {
      console.warn('Failed to clear cookies:', e);
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
