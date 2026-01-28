(function () {
  'use strict';

  var STORAGE_KEY = 'dicaDoDiaShownDate';

  function todayStrLocal() {
    try {
      var d = new Date();
      var y = String(d.getFullYear());
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    } catch (_) {
      return '';
    }
  }

  function getShownDate() {
    try { return String(localStorage.getItem(STORAGE_KEY) || ''); } catch (_) { return ''; }
  }

  function markShownToday() {
    try { localStorage.setItem(STORAGE_KEY, todayStrLocal()); } catch (_) {}
  }

  function ensureModalDom() {
    try {
      if (document.getElementById('dicaModal')) return;

      // Styles (for pages that don't have index.html CSS)
      if (!document.getElementById('dicaDoDiaModalStyles')) {
        var st = document.createElement('style');
        st.id = 'dicaDoDiaModalStyles';
        st.textContent =
          '#dicaModal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,0.72);z-index:2147483647;}' +
          '#dicaModal.active{display:flex;}' +
          '#dicaModal .dica-card{width:min(720px,92vw);background:linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94));border-radius:16px;position:relative;padding:18px 18px 14px;box-shadow:0 18px 60px rgba(0,0,0,0.55);color:#e5e7eb;}' +
          '#dicaModal .dica-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;}' +
          '#dicaModal .dica-title{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.2px;}' +
          '#dicaModal .dica-close{width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.86);cursor:pointer;font-size:1.3rem;line-height:1;display:flex;align-items:center;justify-content:center;}' +
          '#dicaModal .dica-meta{color:#94a3b8;font-size:.82rem;margin:2px 0 10px;}' +
          '#dicaModal .dica-text{font-size:1.02rem;line-height:1.55;color:rgba(255,255,255,0.92);padding:14px 14px;border-radius:12px;background:rgba(15,23,42,0.55);border:1px solid rgba(255,255,255,0.10);white-space:pre-wrap;}' +
          '#dicaModal .dica-text a{color:#93c5fd;text-decoration:underline;}' +
          '#dicaModal .dica-footer{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;}' +
          '#dicaModal .dica-btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.92);cursor:pointer;font-weight:800;}' +
          '#dicaModal .dica-btn.primary{background:rgba(79,70,229,0.25);border-color:rgba(79,70,229,0.55);}';
        document.head.appendChild(st);
      }

      // DOM
      var overlay = document.createElement('div');
      overlay.id = 'dicaModal';
      overlay.className = 'overlay dica-modal';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML =
        '<div class="dica-card" role="dialog" aria-modal="true" aria-label="Dica do dia">' +
          '<div class="dica-header">' +
            '<div class="dica-title"><span>💡</span><span>Dica do dia</span></div>' +
            '<button id="dicaModalClose" type="button" class="dica-close" aria-label="Fechar">×</button>' +
          '</div>' +
          '<div id="dicaModalMeta" class="dica-meta"></div>' +
          '<div id="dicaModalText" class="dica-text">Carregando...</div>' +
          '<div class="dica-footer">' +
            '<button id="dicaModalAnother" type="button" class="dica-btn">Outra dica</button>' +
            '<button id="dicaModalCopy" type="button" class="dica-btn primary">Copiar</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderMarkdownLinksSafe(raw) {
    var escaped = escapeHtml(raw ?? '');
    return escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
      var u = String(url || '').trim();
      if (!/^https?:\/\//i.test(u)) return m;
      return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(text) + '</a>';
    });
  }

  function setOpen(open) {
    ensureModalDom();
    var modal = document.getElementById('dicaModal');
    if (!modal) {
      try { alert('dicaModal não encontrado no DOM'); } catch (_) {}
      return;
    }

    // Escape stacking contexts (e.g., transformed parents) by moving the modal to <body>
    try {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
    } catch (_) {}

    if (open) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      // do NOT set style.display here; it breaks close when class is removed
      try { modal.style.removeProperty('display'); } catch (_) {}
      try {
        var navHide = document.querySelector('.bottom-nav');
        if (navHide) navHide.style.display = 'none';
      } catch (_) {}
      try { document.body.style.overflow = 'hidden'; } catch (_) {}
    } else {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      try { modal.style.removeProperty('display'); } catch (_) {}
      try {
        var navShow = document.querySelector('.bottom-nav');
        if (navShow) navShow.style.display = '';
      } catch (_) {}
      try { document.body.style.overflow = ''; } catch (_) {}

      // Mark as shown for today when user closes it.
      // This is intentionally unconditional: other handlers (e.g., from index.html) may remove
      // the .active class before this handler runs, but we still want to persist the "shown" flag.
      markShownToday();
    }
  }

  function getHeaders() {
    try {
      if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
        return window.Auth.getAuthHeaders({ acceptJson: true });
      }
    } catch (_) {}
    var headers = { 'Accept': 'application/json' };
    try {
      var token = (localStorage.getItem('sessionToken') || '').trim();
      var nomeUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
      var identity = token || nomeUsuario;
      if (identity) headers['X-Session-Token'] = identity;
    } catch (_) {}
    try {
      var jwtTok = (localStorage.getItem('jwtToken') || localStorage.getItem('jwt') || '').trim();
      var jwtType = (localStorage.getItem('jwtTokenType') || localStorage.getItem('jwt_type') || 'Bearer').trim() || 'Bearer';
      if (jwtTok) headers['Authorization'] = jwtType + ' ' + jwtTok;
    } catch (_) {}
    return headers;
  }

  async function loadDica() {
    var text = document.getElementById('dicaModalText');
    var meta = document.getElementById('dicaModalMeta');
    var another = document.getElementById('dicaModalAnother');
    var copyBtn = document.getElementById('dicaModalCopy');

    if (meta) meta.textContent = '';
    if (text) text.textContent = 'Carregando...';
    if (another) another.disabled = true;
    if (copyBtn) copyBtn.disabled = true;

    try {
      var url = '/api/dicas/today?_ts=' + Date.now();
      var r = await fetch(url, { method: 'GET', headers: getHeaders(), cache: 'no-store', credentials: 'include' });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok) {
        var errText = data && (data.message || data.error) ? String(data.message || data.error) : ('Falha ao carregar dica (HTTP ' + r.status + ')');
        if (text) text.textContent = errText;
        return;
      }

      var item = data && (data.item || data);
      var txt = item && item.descricao != null ? String(item.descricao) : '';
      var metaBits = [];
      try {
        if (item && item.versao_code) metaBits.push('Versão: ' + String(item.versao_code));
        else if (item && item.id_versao_pmbok != null) metaBits.push('Versão #' + String(item.id_versao_pmbok));
      } catch (_) {}
      try { if (item && item.id != null) metaBits.push('ID: ' + String(item.id)); } catch (_) {}

      if (meta) meta.textContent = metaBits.join(' • ');
      if (text) text.innerHTML = renderMarkdownLinksSafe(txt || 'Dica vazia.');
      try {
        var modal = document.getElementById('dicaModal');
        if (modal && modal.dataset) modal.dataset.lastDica = txt || '';
      } catch (_) {}
    } catch (_) {
      if (text) text.textContent = 'Erro ao carregar dica.';
    } finally {
      if (another) another.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
    }
  }

  window.openDicaDoDiaModal = function () {
    ensureModalDom();
    setOpen(true);
    loadDica();
  };

  function bindModalClose() {
    ensureModalDom();
    var modal = document.getElementById('dicaModal');
    if (!modal) return;
    if (modal.getAttribute('data-dica-bound') === 'true') return;
    modal.setAttribute('data-dica-bound', 'true');

    // Close button
    var closeBtn = document.getElementById('dicaModalClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (_) {}
        setOpen(false);
      });
    }

    // Click outside (backdrop)
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal) setOpen(false);
    });

    // ESC
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      try {
        if (!modal.classList || !modal.classList.contains('active')) return;
      } catch (_) {}
      setOpen(false);
    });

    // Buttons
    var anotherBtn = document.getElementById('dicaModalAnother');
    if (anotherBtn) anotherBtn.addEventListener('click', function () { loadDica(); });
    var copyBtn = document.getElementById('dicaModalCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async function () {
        try {
          var txt = '';
          try {
            if (modal && modal.dataset && modal.dataset.lastDica) txt = String(modal.dataset.lastDica);
          } catch (_) {}
          if (!txt) {
            var el = document.getElementById('dicaModalText');
            txt = el ? String(el.textContent || '') : '';
          }
          if (!txt) return;
          await navigator.clipboard.writeText(txt);
          try { if (window.showToast) window.showToast('Dica copiada.'); } catch (_) {}
        } catch (_) {
          try { if (window.showToast) window.showToast('Falha ao copiar.'); } catch (_) {}
        }
      });
    }
  }

  function bindCard() {
    ensureModalDom();
    var card = document.getElementById('card-dica-do-dia');
    if (!card) return;

    var handler = function (ev) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      } catch (_) {}
      try { window.openDicaDoDiaModal(); } catch (_) {}
    };

    card.addEventListener('click', handler, true);
    card.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      handler(ev);
    }, true);
  }

  function isIndexPage() {
    try {
      var p = String(window.location && window.location.pathname || '');
      // Normalize: treat '/' and '/index.html' as app start.
      p = p.split('?')[0].split('#')[0];
      p = p.toLowerCase();
      return p === '/' || p === '/index.html';
    } catch (_) {
      return false;
    }
  }

  function maybeAutoShowOnAppStart() {
    try {
      if (!isIndexPage()) return;
      var today = todayStrLocal();
      if (!today) return;
      if (getShownDate() === today) return;

      // Wait a bit for initial paint to avoid jank
      setTimeout(function () {
        try { window.openDicaDoDiaModal(); } catch (_) {}
      }, 250);
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindCard);
    document.addEventListener('DOMContentLoaded', bindModalClose);
    document.addEventListener('DOMContentLoaded', maybeAutoShowOnAppStart);
  } else {
    bindCard();
    bindModalClose();
    maybeAutoShowOnAppStart();
  }
})();
