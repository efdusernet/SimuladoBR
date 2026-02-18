/* contentProtection.js
 * Best-effort client-side friction for copying/printing.
 * IMPORTANT: Browsers cannot reliably disable screenshots/PrintScreen.
 */

(function () {
  'use strict';

  function isEditableTarget(target) {
    if (!target) return false;
    var node = target;
    try {
      // Walk up to handle clicks inside wrappers.
      while (node && node !== document.documentElement) {
        if (node.isContentEditable) return true;
        var tag = (node.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        node = node.parentNode;
      }
    } catch (_) { /* noop */ }
    return false;
  }

  function ensureToast() {
    var el = document.getElementById('cpToast');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'cpToast';
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:16px',
      'transform:translateX(-50%)',
      'z-index:99999',
      'background:rgba(15,23,42,0.92)',
      'color:#fff',
      'padding:10px 12px',
      'border-radius:10px',
      'font:600 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 10px 28px rgba(0,0,0,0.35)',
      'display:none',
      'max-width:92vw',
      'text-align:center'
    ].join(';');

    document.body.appendChild(el);
    return el;
  }

  function showToast(message) {
    try {
      var el = ensureToast();
      el.textContent = message || '';
      el.style.display = 'block';
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () {
        el.style.display = 'none';
      }, 1800);
    } catch (_) { /* noop */ }
  }

  function injectStyle(cssText) {
    try {
      var style = document.createElement('style');
      style.type = 'text/css';
      style.appendChild(document.createTextNode(cssText));
      document.head.appendChild(style);
    } catch (_) { /* noop */ }
  }

  function ensurePrintBlockMessage(text) {
    var el = document.getElementById('printBlockMessage');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'printBlockMessage';
    el.textContent = text || 'Impressão desativada nesta página.';
    el.style.cssText = [
      'display:none',
      'padding:24px 16px',
      'font:800 16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'color:#0f172a'
    ].join(';');

    document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function tryClearClipboard() {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
      // Best-effort; will fail silently if permissions denied.
      navigator.clipboard.writeText('');
    } catch (_) { /* noop */ }
  }

  function enable(options) {
    options = options || {};

    var disableCopyPaste = options.disableCopyPaste !== false;
    var disableContextMenu = options.disableContextMenu !== false;
    var disableSelection = options.disableSelection !== false;
    var disablePrint = options.disablePrint !== false;
    var warnOnPrintScreen = options.warnOnPrintScreen !== false;

    // CSS: selection / print-block
    if (disableSelection) {
      injectStyle(
        'body.cp-no-select{ -webkit-user-select:none; user-select:none; }\n' +
        'body.cp-no-select input, body.cp-no-select textarea, body.cp-no-select select, body.cp-no-select [contenteditable="true"]{ -webkit-user-select:text !important; user-select:text !important; }\n'
      );
      try { document.body.classList.add('cp-no-select'); } catch (_) { /* noop */ }
    }

    if (disablePrint) {
      ensurePrintBlockMessage(options.printMessage || 'Impressão desativada nesta página.');
      injectStyle(
        '@media print {\n' +
        '  body > * { display:none !important; }\n' +
        '  #printBlockMessage { display:block !important; }\n' +
        '}\n'
      );

      // Best-effort intercepts for print triggers
      try {
        var originalPrint = window.print;
        window.print = function () {
          showToast('Impressão desativada nesta página.');
          return undefined;
        };
        window.print._original = originalPrint;
      } catch (_) { /* noop */ }

      window.addEventListener('beforeprint', function () {
        showToast('Impressão desativada nesta página.');
      });
    }

    // Events: copy/cut/paste
    if (disableCopyPaste) {
      ['copy', 'cut', 'paste'].forEach(function (evtName) {
        document.addEventListener(evtName, function (e) {
          try {
            if (isEditableTarget(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            if (evtName === 'paste') showToast('Colar desativado.');
            else showToast('Copiar desativado.');
            if (evtName === 'copy' || evtName === 'cut') tryClearClipboard();
          } catch (_) { /* noop */ }
        }, true);
      });
    }

    if (disableContextMenu) {
      document.addEventListener('contextmenu', function (e) {
        try {
          if (isEditableTarget(e.target)) return;
          e.preventDefault();
          showToast('Menu de contexto desativado.');
        } catch (_) { /* noop */ }
      }, true);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      try {
        var key = (e.key || '').toLowerCase();
        var isMod = e.ctrlKey || e.metaKey;

        // Print
        if (disablePrint && isMod && key === 'p') {
          e.preventDefault();
          e.stopPropagation();
          showToast('Impressão desativada nesta página.');
          return;
        }

        // Copy/cut/paste shortcuts
        if (disableCopyPaste && isMod && (key === 'c' || key === 'x' || key === 'v')) {
          if (isEditableTarget(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          showToast('Copiar/colar desativado.');
          if (key === 'c' || key === 'x') tryClearClipboard();
          return;
        }

        // PrintScreen (best-effort)
        if (warnOnPrintScreen) {
          if (key === 'printscreen' || e.keyCode === 44) {
            showToast('Captura de tela não permitida.');
            tryClearClipboard();
            try {
              document.body.classList.add('cp-blur');
              setTimeout(function () { document.body.classList.remove('cp-blur'); }, 650);
            } catch (_) { /* noop */ }
          }
        }
      } catch (_) { /* noop */ }
    }, true);

    // Optional blur effect when user tries PrintScreen
    injectStyle(
      'body.cp-blur{ filter: blur(10px); }\n'
    );
  }

  // Expose
  window.ContentProtection = {
    enable: enable
  };
})();
