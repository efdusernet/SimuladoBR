(function(){
  const STYLE_ID = 'simulados-calculator-style';
  const OVERLAY_ID = 'simulados-calculator-overlay';

  let mounted = false;
  let overlayEl = null;
  let dialogEl = null;
  let displayEl = null;

  let input = '0';
  let acc = null;
  let pendingOp = null;
  let justEvaluated = false;

  function fmtNumber(n){
    if (n === null || n === undefined) return '0';
    if (!Number.isFinite(n)) return 'Erro';
    const s = String(n);
    if (s.includes('e') || s.includes('E')) return n.toPrecision(10).replace(/0+$/,'').replace(/\.$/, '');
    return s;
  }

  function parseInput(){
    const v = Number(input);
    return Number.isFinite(v) ? v : NaN;
  }

  function setDisplay(text){
    if (!displayEl) return;
    displayEl.textContent = text;
  }

  function syncDisplay(){
    setDisplay(input);
  }

  function resetAll(){
    input = '0';
    acc = null;
    pendingOp = null;
    justEvaluated = false;
    syncDisplay();
  }

  function doOp(a, op, b){
    switch(op){
      case '+': return a + b;
      case '−':
      case '-': return a - b;
      case '×':
      case '*': return a * b;
      case '÷':
      case '/':
        if (b === 0) return NaN;
        return a / b;
      default:
        return b;
    }
  }

  function pressDigit(d){
    if (input === 'Erro') input = '0';
    if (justEvaluated && !pendingOp){
      input = '0';
      justEvaluated = false;
    }
    if (input === '0') input = String(d);
    else input += String(d);
    syncDisplay();
  }

  function pressDot(){
    if (input === 'Erro') input = '0';
    if (justEvaluated && !pendingOp){
      input = '0';
      justEvaluated = false;
    }
    if (!input.includes('.')) input += '.';
    syncDisplay();
  }

  function pressBackspace(){
    if (input === 'Erro') { input = '0'; syncDisplay(); return; }
    if (justEvaluated) { input = '0'; justEvaluated = false; syncDisplay(); return; }
    if (input.length <= 1 || (input.length === 2 && input.startsWith('-'))) input = '0';
    else input = input.slice(0, -1);
    syncDisplay();
  }

  function pressSign(){
    if (input === 'Erro') { input = '0'; }
    if (input === '0' || input === '0.') { syncDisplay(); return; }
    if (input.startsWith('-')) input = input.slice(1);
    else input = '-' + input;
    syncDisplay();
  }

  function pressOp(op){
    if (input === 'Erro') return;

    const current = parseInput();
    if (!Number.isFinite(current)) return;

    if (acc === null){
      acc = current;
    } else if (pendingOp && !justEvaluated){
      const r = doOp(acc, pendingOp, current);
      if (!Number.isFinite(r)) {
        input = 'Erro';
        acc = null;
        pendingOp = null;
        justEvaluated = false;
        syncDisplay();
        return;
      }
      acc = r;
      input = fmtNumber(r);
    }

    pendingOp = op;
    justEvaluated = false;
    input = '0';
    syncDisplay();
  }

  function pressEquals(){
    if (input === 'Erro') return;
    const current = parseInput();
    if (!Number.isFinite(current)) return;

    if (pendingOp && acc !== null){
      const r = doOp(acc, pendingOp, current);
      if (!Number.isFinite(r)) {
        input = 'Erro';
        acc = null;
        pendingOp = null;
        justEvaluated = false;
        syncDisplay();
        return;
      }
      input = fmtNumber(r);
      acc = null;
      pendingOp = null;
      justEvaluated = true;
      syncDisplay();
      return;
    }

    justEvaluated = true;
    syncDisplay();
  }

  function injectStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID}{
        position: fixed; inset: 0; z-index: 2200;
        background: rgba(0,0,0,0.55);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      #${OVERLAY_ID}[data-open="1"]{ display: flex; }
      #${OVERLAY_ID} .sim-calc{
        width: min(320px, 96vw);
        background: #1f2937;
        color: #f9fafb;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        overflow: hidden;
        font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      }
      #${OVERLAY_ID} .sim-calc-header{
        display:flex; align-items:center; justify-content:space-between;
        padding: 10px 12px;
        background: rgba(255,255,255,0.06);
        border-bottom: 1px solid rgba(255,255,255,0.10);
      }
      #${OVERLAY_ID} .sim-calc-title{ font-weight: 900; font-size: 0.92rem; opacity: 0.95; }
      #${OVERLAY_ID} .sim-calc-close{
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.08);
        color: #f9fafb;
        border-radius: 10px;
        height: 30px;
        padding: 0 10px;
        cursor:pointer;
        font-weight: 800;
      }
      #${OVERLAY_ID} .sim-calc-close:hover{ background: rgba(255,255,255,0.12); }
      #${OVERLAY_ID} .sim-calc-display{
        padding: 14px 12px;
        text-align: right;
        font-weight: 950;
        font-size: 1.55rem;
        letter-spacing: 0.2px;
        background: #111827;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        user-select: text;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${OVERLAY_ID} .sim-calc-grid{
        display:grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        padding: 12px;
        background: #1f2937;
      }
      #${OVERLAY_ID} .sim-calc-btn{
        height: 42px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.08);
        color: #f9fafb;
        font-weight: 900;
        font-size: 1rem;
        cursor: pointer;
      }
      #${OVERLAY_ID} .sim-calc-btn:hover{ background: rgba(255,255,255,0.12); }
      #${OVERLAY_ID} .sim-calc-btn:active{ transform: translateY(1px); }
      #${OVERLAY_ID} .sim-calc-btn.op{ background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.26); }
      #${OVERLAY_ID} .sim-calc-btn.danger{ background: rgba(239,68,68,0.18); border-color: rgba(239,68,68,0.26); }
      #${OVERLAY_ID} .sim-calc-btn.eq{ background: rgba(34,197,94,0.20); border-color: rgba(34,197,94,0.30); }
      #${OVERLAY_ID} .sim-calc-btn.wide{ grid-column: span 2; }
      #${OVERLAY_ID} .sim-calc-btn:focus-visible{ outline: 3px solid rgba(59,130,246,0.55); outline-offset: 2px; }
    `;
    document.head.appendChild(style);
  }

  function buildDom(){
    if (document.getElementById(OVERLAY_ID)) return;

    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.setAttribute('aria-hidden', 'true');

    overlayEl.innerHTML = `
      <div class="sim-calc" role="dialog" aria-modal="true" aria-label="Calculadora" tabindex="-1">
        <div class="sim-calc-header">
          <div class="sim-calc-title">Calculadora</div>
          <button type="button" class="sim-calc-close" data-action="close">Fechar</button>
        </div>
        <div class="sim-calc-display" data-role="display">0</div>
        <div class="sim-calc-grid">
          <button type="button" class="sim-calc-btn danger" data-action="clear">C</button>
          <button type="button" class="sim-calc-btn" data-action="back">⌫</button>
          <button type="button" class="sim-calc-btn" data-action="sign">±</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="÷">÷</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="7">7</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="8">8</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="9">9</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="×">×</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="4">4</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="5">5</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="6">6</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="−">−</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="1">1</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="2">2</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="3">3</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="+">+</button>

          <button type="button" class="sim-calc-btn wide" data-action="digit" data-digit="0">0</button>
          <button type="button" class="sim-calc-btn" data-action="dot">.</button>
          <button type="button" class="sim-calc-btn eq" data-action="eq">=</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    dialogEl = overlayEl.querySelector('.sim-calc');
    displayEl = overlayEl.querySelector('[data-role="display"]');

    overlayEl.addEventListener('click', (ev)=>{
      if (ev.target === overlayEl) close();
    });

    overlayEl.addEventListener('click', (ev)=>{
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;
      const act = t.getAttribute('data-action');
      if (!act) return;
      ev.preventDefault();

      if (act === 'close') return close();
      if (act === 'clear') return resetAll();
      if (act === 'back') return pressBackspace();
      if (act === 'sign') return pressSign();
      if (act === 'dot') return pressDot();
      if (act === 'eq') return pressEquals();
      if (act === 'digit') return pressDigit(t.getAttribute('data-digit'));
      if (act === 'op') return pressOp(t.getAttribute('data-op'));
    });

    window.addEventListener('keydown', (ev)=>{
      if (!isOpen()) return;

      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key === 'Enter' || ev.key === '=') { ev.preventDefault(); pressEquals(); return; }
      if (ev.key === 'Backspace') { ev.preventDefault(); pressBackspace(); return; }
      if (ev.key === 'Delete') { ev.preventDefault(); resetAll(); return; }

      if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); pressDigit(ev.key); return; }
      if (ev.key === '.') { ev.preventDefault(); pressDot(); return; }

      if (ev.key === '+' || ev.key === '-' || ev.key === '*' || ev.key === '/') {
        ev.preventDefault();
        const map = { '+': '+', '-': '−', '*': '×', '/': '÷' };
        pressOp(map[ev.key]);
        return;
      }
    });
  }

  function ensure(){
    if (mounted) return;
    injectStyle();
    buildDom();
    mounted = true;
    resetAll();
  }

  function isOpen(){
    const el = document.getElementById(OVERLAY_ID);
    return !!(el && el.getAttribute('data-open') === '1');
  }

  function open(){
    ensure();
    overlayEl.setAttribute('data-open', '1');
    overlayEl.setAttribute('aria-hidden', 'false');
    try {
      const first = overlayEl.querySelector('.sim-calc-btn');
      if (first) first.focus();
      else if (dialogEl) dialogEl.focus();
    } catch(_){ }
  }

  function close(){
    ensure();
    overlayEl.removeAttribute('data-open');
    overlayEl.setAttribute('aria-hidden', 'true');
  }

  function toggle(){
    if (isOpen()) close(); else open();
  }

  function setValue(v){
    ensure();
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    input = fmtNumber(n);
    acc = null;
    pendingOp = null;
    justEvaluated = true;
    syncDisplay();
  }

  function getValue(){
    const n = Number(input);
    return Number.isFinite(n) ? n : null;
  }

  window.Calculator = {
    ensure,
    open,
    close,
    toggle,
    reset: resetAll,
    setValue,
    getValue
  };
})();
