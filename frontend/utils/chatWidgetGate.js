// Loads the support chat widget only for premium users on desktop layout.
// Premium rule: Usuario.BloqueioAtivado === false.

(function () {
  const WIDGET_SRC = '/chat/widget/chat-widget.js';
  const CHAT_API = '/chat';
  const CHAT_TITLE = 'Suporte';

  let premiumStatusPromise = null;

  function getSessionToken() {
    try {
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
        const token = getSessionToken();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['X-Session-Token'] = token;

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

    const isPremium = await isPremiumUser();
    if (!isPremium) {
      removeWidget();
      return;
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
