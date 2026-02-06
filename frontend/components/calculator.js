(function(){
  const STYLE_ID = 'simulados-calculator-style';
  const OVERLAY_ID = 'simulados-calculator-overlay';
  const POS_STORAGE_KEY = 'simulados_calculator_pos_v1';

  let mounted = false;
  let overlayEl = null;
  let dialogEl = null;
  let displayEl = null;

  // Drag state (translate offsets in px)
  let dragDx = 0;
  let dragDy = 0;
  let dragActive = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartDx = 0;
  let dragStartDy = 0;
  let posLoaded = false;

  function applyDragTransform(){
    if (!dialogEl) return;
    try { dialogEl.style.setProperty('--sim-calc-dx', `${Math.round(dragDx)}px`); } catch(_){ }
    try { dialogEl.style.setProperty('--sim-calc-dy', `${Math.round(dragDy)}px`); } catch(_){ }
  }

  function clampToViewport(nextDx, nextDy){
    if (!overlayEl || !dialogEl) return { dx: nextDx, dy: nextDy };
    try {
      // Predict final rect by applying temp values
      const prevDx = dragDx;
      const prevDy = dragDy;
      dragDx = nextDx;
      dragDy = nextDy;
      applyDragTransform();

      const pad = 8;
      const r = dialogEl.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;

      let dx = nextDx;
      let dy = nextDy;

      if (vw > 0) {
        if (r.left < pad) dx += (pad - r.left);
        if (r.right > vw - pad) dx -= (r.right - (vw - pad));
      }
      if (vh > 0) {
        if (r.top < pad) dy += (pad - r.top);
        if (r.bottom > vh - pad) dy -= (r.bottom - (vh - pad));
      }

      // Restore then return clamped values
      dragDx = prevDx;
      dragDy = prevDy;
      applyDragTransform();
      return { dx, dy };
    } catch (_){
      return { dx: nextDx, dy: nextDy };
    }
  }

  function loadPositionOnce(){
    if (posLoaded) return;
    posLoaded = true;
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const dx = Number(obj && obj.dx);
      const dy = Number(obj && obj.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      // Sanity bounds to avoid huge offsets
      dragDx = Math.max(-5000, Math.min(5000, dx));
      dragDy = Math.max(-5000, Math.min(5000, dy));
      applyDragTransform();
    } catch(_){ }
  }

  function savePosition(){
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ dx: dragDx, dy: dragDy }));
    } catch(_){ }
  }

  function resetPositionToCenter(){
    dragDx = 0;
    dragDy = 0;
    applyDragTransform();
    savePosition();
  }

  let input = '0';
  let justEvaluated = false;

  const OPS = ['+', '−', '×', '÷'];

  function isOp(ch){
    return OPS.includes(ch);
  }

  function toInternalExpr(expr){
    return String(expr || '')
      .replace(/\s+/g, '')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-');
  }

  function isDigit(ch){
    return ch >= '0' && ch <= '9';
  }

  function isNumberChar(ch){
    return isDigit(ch) || ch === '.';
  }

  function tokenize(expr){
    const s = toInternalExpr(expr);
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue; }
      if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
        tokens.push({ t: 'op', v: ch });
        i++;
        continue;
      }

      if (isDigit(ch) || ch === '.') {
        let j = i;
        let dotCount = 0;
        while (j < s.length && (isDigit(s[j]) || s[j] === '.')) {
          if (s[j] === '.') dotCount++;
          if (dotCount > 1) break;
          j++;
        }
        const raw = s.slice(i, j);
        if (raw === '.' || raw === '-.') return null;
        const num = Number(raw);
        if (!Number.isFinite(num)) return null;
        tokens.push({ t: 'num', v: num, raw });
        i = j;
        continue;
      }

      // Invalid char
      return null;
    }
    return tokens;
  }

  function toRpn(tokens){
    const out = [];
    const stack = [];

    // Convert unary minus to a dedicated operator 'u-'
    const normalized = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.t === 'op' && tok.v === '-') {
        const prev = normalized.length ? normalized[normalized.length - 1] : null;
        const isUnary = !prev || prev.t === '(' || (prev.t === 'op' && prev.v !== ')');
        if (isUnary) {
          normalized.push({ t: 'op', v: 'u-' });
          continue;
        }
      }
      normalized.push(tok);
    }

    const prec = (op) => {
      if (op === 'u-') return 3;
      if (op === '*' || op === '/') return 2;
      if (op === '+' || op === '-') return 1;
      return 0;
    };
    const rightAssoc = (op) => op === 'u-';

    for (const tok of normalized) {
      if (tok.t === 'num') { out.push(tok); continue; }
      if (tok.t === '(') { stack.push(tok); continue; }
      if (tok.t === ')') {
        while (stack.length && stack[stack.length - 1].t !== '(') {
          out.push(stack.pop());
        }
        if (!stack.length) return null; // mismatched
        stack.pop();
        continue;
      }
      if (tok.t === 'op') {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t !== 'op') break;
          const pTop = prec(top.v);
          const pTok = prec(tok.v);
          if (pTop > pTok || (pTop === pTok && !rightAssoc(tok.v))) {
            out.push(stack.pop());
          } else {
            break;
          }
        }
        stack.push(tok);
        continue;
      }
      return null;
    }

    while (stack.length) {
      const top = stack.pop();
      if (top.t === '(' || top.t === ')') return null;
      out.push(top);
    }
    return out;
  }

  function evalRpn(rpn){
    const st = [];
    for (const tok of rpn) {
      if (tok.t === 'num') { st.push(tok.v); continue; }
      if (tok.t === 'op') {
        if (tok.v === 'u-') {
          if (st.length < 1) return NaN;
          const a = st.pop();
          st.push(-a);
          continue;
        }
        if (st.length < 2) return NaN;
        const b = st.pop();
        const a = st.pop();
        let r;
        switch (tok.v) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/':
            if (b === 0) return NaN;
            r = a / b;
            break;
          default: return NaN;
        }
        if (!Number.isFinite(r)) return NaN;
        st.push(r);
        continue;
      }
      return NaN;
    }
    if (st.length !== 1) return NaN;
    return st[0];
  }

  function evaluateExpression(expr){
    const tokens = tokenize(expr);
    if (!tokens || !tokens.length) return NaN;
    const rpn = toRpn(tokens);
    if (!rpn) return NaN;
    return evalRpn(rpn);
  }

  function fmtNumber(n){
    if (n === null || n === undefined) return '0';
    if (!Number.isFinite(n)) return 'Erro';
    const s = String(n);
    if (s.includes('e') || s.includes('E')) return n.toPrecision(10).replace(/0+$/,'').replace(/\.$/, '');
    return s;
  }

  function parseInput(){
    const v = Number(toInternalExpr(input));
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
    justEvaluated = false;
    syncDisplay();
  }

  function lastChar(){
    return input ? input.slice(-1) : '';
  }

  function canImplicitMultiply(){
    const ch = lastChar();
    if (!ch) return false;
    return isNumberChar(ch) || ch === ')';
  }

  function stripTrailingOps(){
    while (input.length && isOp(lastChar())) input = input.slice(0, -1);
  }

  function pressDigit(d){
    if (input === 'Erro') input = '0';
    if (justEvaluated){
      input = '0';
      justEvaluated = false;
    }

    if (canImplicitMultiply() && lastChar() === ')') {
      input += '×';
    }

    if (input === '0') input = String(d);
    else input += String(d);
    syncDisplay();
  }

  function pressDot(){
    if (input === 'Erro') input = '0';
    if (justEvaluated){
      input = '0';
      justEvaluated = false;
    }

    // Allow one dot per current number segment
    for (let i = input.length - 1; i >= 0; i--) {
      const ch = input[i];
      if (ch === '.') return;
      if (!isNumberChar(ch)) break;
    }

    if (canImplicitMultiply() && lastChar() === ')') input += '×';
    if (!isNumberChar(lastChar())) input += '0';
    input += '.';
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

    // Toggle sign of the last number segment
    const s = input;
    let end = s.length - 1;
    while (end >= 0 && s[end] === ' ') end--;
    if (end < 0) { syncDisplay(); return; }

    // If cursor is at ')' we don't try to negate groups (keep it simple)
    if (s[end] === ')') { syncDisplay(); return; }

    // Find start of number
    let start = end;
    while (start >= 0 && isNumberChar(s[start])) start--;
    const numStart = start + 1;
    if (numStart > end) { syncDisplay(); return; }

    // Check for a unary '-' just before the number
    const before = start >= 0 ? s[start] : '';
    const before2 = start - 1 >= 0 ? s[start - 1] : '';
    const canBeUnary = !before || before === '(' || isOp(before) || before2 === '(';
    if (before === '−' && canBeUnary) {
      input = s.slice(0, start) + s.slice(numStart);
    } else {
      input = s.slice(0, numStart) ? (s.slice(0, numStart) + '−' + s.slice(numStart)) : ('−' + s.slice(numStart));
    }
    syncDisplay();
  }

  function pressOp(op){
    if (input === 'Erro') return;

    if (justEvaluated) justEvaluated = false;

    // Replace trailing operator
    stripTrailingOps();
    if (!input || input === '0') {
      if (op === '−') input = '−';
      else return;
    } else {
      input += op;
    }
    syncDisplay();
  }

  function pressParen(p){
    if (input === 'Erro') input = '0';
    if (justEvaluated) { input = '0'; justEvaluated = false; }
    const ch = String(p);
    if (ch !== '(' && ch !== ')') return;

    if (ch === '(') {
      if (canImplicitMultiply()) input += '×';
      if (input === '0') input = '(';
      else input += '(';
      syncDisplay();
      return;
    }

    // ')': only allow if there is an unmatched '('
    const s = input;
    let bal = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') bal++;
      else if (s[i] === ')') bal--;
    }
    if (bal <= 0) return;

    const last = lastChar();
    if (!last || isOp(last) || last === '(') return;
    input += ')';
    syncDisplay();
  }

  function pressEquals(){
    if (input === 'Erro') return;

    // Auto-close parentheses
    try {
      let bal = 0;
      for (const ch of input) {
        if (ch === '(') bal++;
        else if (ch === ')') bal--;
      }
      if (bal > 0) input += ')'.repeat(Math.min(bal, 20));
    } catch(_){ }

    const r = evaluateExpression(input);
    if (!Number.isFinite(r)) {
      input = 'Erro';
      justEvaluated = false;
      syncDisplay();
      return;
    }

    input = fmtNumber(r);
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
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%) translate(var(--sim-calc-dx, 0px), var(--sim-calc-dy, 0px));
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
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      #${OVERLAY_ID} .sim-calc[data-dragging="1"] .sim-calc-header{ cursor: grabbing; }
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
          <button type="button" class="sim-calc-btn" data-action="paren" data-paren="(">(</button>
          <button type="button" class="sim-calc-btn" data-action="paren" data-paren=")">)</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="7">7</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="8">8</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="9">9</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="÷">÷</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="4">4</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="5">5</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="6">6</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="×">×</button>

          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="1">1</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="2">2</button>
          <button type="button" class="sim-calc-btn" data-action="digit" data-digit="3">3</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="−">−</button>

          <button type="button" class="sim-calc-btn wide" data-action="digit" data-digit="0">0</button>
          <button type="button" class="sim-calc-btn" data-action="dot">.</button>
          <button type="button" class="sim-calc-btn op" data-action="op" data-op="+">+</button>

          <button type="button" class="sim-calc-btn wide" data-action="sign">±</button>
          <button type="button" class="sim-calc-btn eq wide" data-action="eq">=</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    dialogEl = overlayEl.querySelector('.sim-calc');
    displayEl = overlayEl.querySelector('[data-role="display"]');

    function startDrag(ev){
      try {
        if (!ev) return;
        // Only primary button for mouse; touch/pen ok
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        // Avoid starting drag when clicking the close button
        const t = ev.target;
        if (t && t instanceof HTMLElement) {
          if (t.closest && t.closest('.sim-calc-close')) return;
        }

        dragActive = true;
        dragPointerId = ev.pointerId;
        dragStartX = ev.clientX;
        dragStartY = ev.clientY;
        dragStartDx = dragDx;
        dragStartDy = dragDy;
        try { dialogEl.setAttribute('data-dragging', '1'); } catch(_){ }

        try { ev.preventDefault(); } catch(_){ }
        try { header.setPointerCapture(ev.pointerId); } catch(_){ }
      } catch(_){ }
    }

    function moveDrag(ev){
      try {
        if (!dragActive) return;
        if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
        const nx = dragStartDx + (ev.clientX - dragStartX);
        const ny = dragStartDy + (ev.clientY - dragStartY);
        const clamped = clampToViewport(nx, ny);
        dragDx = clamped.dx;
        dragDy = clamped.dy;
        applyDragTransform();
        try { ev.preventDefault(); } catch(_){ }
      } catch(_){ }
    }

    function endDrag(ev){
      try {
        if (!dragActive) return;
        if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
        dragActive = false;
        dragPointerId = null;
        try { dialogEl.removeAttribute('data-dragging'); } catch(_){ }
        try { savePosition(); } catch(_){ }
        try { ev.preventDefault(); } catch(_){ }
      } catch(_){ }
    }

    const header = overlayEl.querySelector('.sim-calc-header');
    if (header) {
      header.addEventListener('pointerdown', startDrag);
      header.addEventListener('pointermove', moveDrag);
      header.addEventListener('pointerup', endDrag);
      header.addEventListener('pointercancel', endDrag);
      header.addEventListener('dblclick', (ev)=>{
        try { ev.preventDefault(); } catch(_){ }
        resetPositionToCenter();
      });
    }

    window.addEventListener('resize', ()=>{
      try {
        const clamped = clampToViewport(dragDx, dragDy);
        dragDx = clamped.dx;
        dragDy = clamped.dy;
        applyDragTransform();
        savePosition();
      } catch(_){ }
    });

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
      if (act === 'paren') return pressParen(t.getAttribute('data-paren'));
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
      if (ev.key === '(' || ev.key === ')') { ev.preventDefault(); pressParen(ev.key); return; }
      if (ev.key === ',') { ev.preventDefault(); pressDot(); return; }

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
    loadPositionOnce();
    resetAll();
  }

  function isOpen(){
    const el = document.getElementById(OVERLAY_ID);
    return !!(el && el.getAttribute('data-open') === '1');
  }

  function open(){
    ensure();
    // Clamp position before showing (in case viewport changed)
    try {
      const clamped = clampToViewport(dragDx, dragDy);
      dragDx = clamped.dx;
      dragDy = clamped.dy;
      applyDragTransform();
    } catch(_){ }
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
