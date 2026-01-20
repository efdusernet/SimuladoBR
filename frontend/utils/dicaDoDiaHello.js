(function () {
  'use strict';

  function setOpen(open) {
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
      if (text) text.textContent = txt || 'Dica vazia.';
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
    setOpen(true);
    loadDica();
  };

  function bindModalClose() {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindCard);
    document.addEventListener('DOMContentLoaded', bindModalClose);
  } else {
    bindCard();
    bindModalClose();
  }
})();
