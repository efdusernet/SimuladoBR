// Loads the support chat widget only for premium users on desktop layout.
// Premium rule: Usuario.BloqueioAtivado === false.

(function () {
  const WIDGET_SRC = '/chat/widget/chat-widget.js';
  const CHAT_API = '/chat';
  const CHAT_TITLE = 'Suporte';

  let premiumStatusPromise = null;
  let userParamsPromise = null;

  function getSessionToken() {
    try {
      if (window.Auth && typeof window.Auth.getSessionToken === 'function') {
        return String(window.Auth.getSessionToken() || '').trim();
      }
      return String((localStorage.getItem('sessionToken') || '')).trim();
    } catch (_) {
      return '';
    }
  }

  function isDesktopLayout() {
    try {
      const v = document.body && document.body.getAttribute('data-layout');
      return v === 'desktop';
    } catch (_) {
      return false;
    }
  }

  async function getUserParams() {
    if (userParamsPromise) return userParamsPromise;
    userParamsPromise = (async () => {
      try {
        const resp = await fetch('/api/meta/user-params', { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => null);
        return data && data.params ? data.params : null;
      } catch (_) {
        return null;
      }
    })();
    return userParamsPromise;
  }

  function isPremiumOnlyChatWidgetDesktop(params) {
    try {
      if (!params || !params.premiumOnly) return true;
      const v = params.premiumOnly.chatWidgetDesktop;
      if (typeof v === 'boolean') return v;
      return true;
    } catch (_) {
      return true;
    }
  }

  function findWidgetScript() {
    return document.querySelector('script[data-simuladosbr-chat-widget="1"]');
  }

  function removeWidget() {
    try {
      const s = findWidgetScript();
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (_) {}
  }

  async function isPremiumUser() {
    if (premiumStatusPromise) return premiumStatusPromise;

    premiumStatusPromise = (async () => {
      try {
        const headers = (window.Auth && typeof window.Auth.getAuthHeaders === 'function')
          ? window.Auth.getAuthHeaders({ acceptJson: true })
          : { 'Accept': 'application/json' };

        const resp = await fetch('/api/users/me', {
          method: 'GET',
          credentials: 'include',
          headers,
        });

        if (!resp.ok) return false;
        const data = await resp.json();

        // Free users: BloqueioAtivado === true
        // Premium users: BloqueioAtivado === false
        return data && data.BloqueioAtivado === false;
      } catch (_) {
        return false;
      }
    })();

    return premiumStatusPromise;
  }

  async function ensureWidgetLoadedIfAllowed() {
    if (!isDesktopLayout()) {
      removeWidget();
      return;
    }

    const params = await getUserParams();
    const premiumOnly = isPremiumOnlyChatWidgetDesktop(params);

    // Always require an active session identity to avoid injecting the widget on anonymous pages.
    const sessionIdentity = getSessionToken();
    if (!sessionIdentity) {
      removeWidget();
      return;
    }

    if (premiumOnly) {
      const isPremium = await isPremiumUser();
      if (!isPremium) {
        removeWidget();
        return;
      }
    }

    if (findWidgetScript()) return;

    const s = document.createElement('script');
    s.src = WIDGET_SRC;
    s.async = true;
    s.dataset.chatApi = CHAT_API;
    s.dataset.chatTitle = CHAT_TITLE;
    s.dataset.simuladosbrChatWidget = '1';
    document.head.appendChild(s);
  }

  function init() {
    // Run once after initial layout evaluation
    ensureWidgetLoadedIfAllowed();

    // If LayoutManager is present, re-check on layout changes.
    try {
      if (window.LayoutManager && typeof window.LayoutManager.onChange === 'function') {
        window.LayoutManager.onChange(() => ensureWidgetLoadedIfAllowed());
      }
    } catch (_) {}

    // Safety: re-check after a short delay in case layout attribute is set late.
    setTimeout(() => ensureWidgetLoadedIfAllowed(), 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
