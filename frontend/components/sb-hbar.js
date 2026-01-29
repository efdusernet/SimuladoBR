// Web Component: <sb-hbar>
// Horizontal bar (single or multiple) with JSON dataset support.
// Usage examples:
// 1) Single bar via attributes:
//    <sb-hbar value="72" max="100" label="Aproveitamento" color="#16a34a" height="14" show-percent unit="%"></sb-hbar>
// 2) Multiple bars via JSON dataset (attribute or property):
//    <sb-hbar data='[{"label":"Domínio 1","value":45},{"label":"Domínio 2","value":80,"color":"#2563eb"}]' show-percent></sb-hbar>
//    // or in JS: el.data = [{ label: 'D1', value: 30 }, { label:'D2', value: 60 }]
// Notes:
// - Each item supports: { label, value, max=100, color, bg, unit, tooltip }
// - Component attributes (single bar mode): value, max, label, color, background, height, radius, striped, animated, show-percent, unit
// - Percent formatting (when show-percent is enabled):
//   - percent-decimals: number of decimal places (default: 0)
//   - percent-rounding: 'round' (default) | 'floor' | 'ceil'
// - Accessible: uses role=group/progressbar and ARIA attributes.

(function(){
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{ display:block; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; color: var(--sb-hbar-text, inherit); }
      .wrap{ display:flex; flex-direction:column; gap:6px; }
      .row{ display:flex; align-items:center; gap:8px; min-height:18px; }
      .label{ flex:0 0 auto; color: var(--sb-hbar-label, inherit); font-size:12px; min-width:72px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .track{ position:relative; flex:1 1 auto; height:12px; background: var(--sb-hbar-track, #e5e7eb); border-radius: 999px; overflow:hidden; }
      .bar{ position:absolute; left:0; top:0; bottom:0; width:0; background: var(--sb-hbar-color, #16a34a); border-radius:999px; transition: width .45s ease; }
      .bar.striped{ background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 8px, transparent 8px 16px); }
      .bar.animated{ animation: sbh-move 1s linear infinite; background-size: 16px 16px; }
      @keyframes sbh-move{ from { background-position: 0 0; } to { background-position: 16px 0; } }
      .val{ flex: 0 0 auto; color: var(--sb-hbar-value, inherit); font-size:12px; min-width:36px; text-align:right; }
      .tooltip{ position:absolute; right:6px; top:50%; transform:translateY(-50%); color: var(--sb-hbar-tooltip-color, currentColor); font-size:11px; text-shadow: var(--sb-hbar-tooltip-shadow, 0 1px 1px rgba(0,0,0,.35)); }
      .sr-only{ position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    </style>
    <div class="wrap" part="wrap"></div>
  `;

  function toNumber(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
  function toInt(v, d){ const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function roundToMode(value, mode){
    if (mode === 'floor') return Math.floor(value);
    if (mode === 'ceil') return Math.ceil(value);
    return Math.round(value);
  }

  function formatPercent(pct, decimals){
    const d = Math.min(6, Math.max(0, toInt(decimals, 0)));
    return Number(pct).toFixed(d);
  }

  function computePercent(value, max, decimals, roundingMode){
    const ratio = max > 0 ? clamp01(value / max) : 0;
    const pctRaw = ratio * 100;
    const d = Math.min(6, Math.max(0, toInt(decimals, 0)));
    const factor = Math.pow(10, d);
    const scaled = pctRaw * factor;
    const scaledRounded = roundToMode(scaled, roundingMode || 'round');
    const pct = scaledRounded / factor;
    return { pct, d };
  }

  class SBHBar extends HTMLElement{
    static get observedAttributes(){ return ['value','max','label','color','background','height','radius','striped','animated','show-percent','unit','data','percent-decimals','percent-rounding']; }
    constructor(){
      super();
      this._root = this.attachShadow({ mode:'open' });
      this._root.appendChild(tpl.content.cloneNode(true));
      this._wrap = this._root.querySelector('.wrap');
      this._data = null; // array or null
    }

    set data(arr){
      if (Array.isArray(arr)) { this._data = arr; this.removeAttribute('data'); this._render(); }
    }
    get data(){
      if (this._data) return this._data;
      const raw = this.getAttribute('data');
      if (!raw) return null;
      try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch(_){ return null; }
    }

    connectedCallback(){ this._render(); }
    attributeChangedCallback(){ this._render(); }

    _render(){
      const multiple = Array.isArray(this.data);
      const showPercent = this.hasAttribute('show-percent');
      const striped = this.hasAttribute('striped');
      const animated = this.hasAttribute('animated');
      const radius = this.getAttribute('radius');
      const heightAttr = this.getAttribute('height');
      const bg = this.getAttribute('background');
      const percentDecimalsAttr = toInt(this.getAttribute('percent-decimals'), 0);
      const percentRoundingAttr = (this.getAttribute('percent-rounding') || 'round').toLowerCase();

      // Clear
      this._wrap.innerHTML = '';

      if (multiple) {
        const items = this.data || [];
        items.forEach((it) => {
          const label = (it && (it.label ?? it.nome ?? it.name)) || '';
          const max = toNumber((it && it.max) ?? this.getAttribute('max'), 100);
          const unit = (it && it.unit) || this.getAttribute('unit') || '';
          const trackBg = (it && (it.bg || it.background)) || bg || '#e5e7eb';
          const percentDecimals = Number.isFinite(parseInt(it && it.percentDecimals, 10)) ? parseInt(it.percentDecimals, 10) : percentDecimalsAttr;
          const percentRounding = String((it && it.percentRounding) || percentRoundingAttr || 'round').toLowerCase();

          const row = document.createElement('div'); row.className='row'; row.setAttribute('part','row');
          const lab = document.createElement('div'); lab.className='label'; lab.textContent = label; lab.setAttribute('part','label');
          const track = document.createElement('div'); track.className='track'; track.style.setProperty('--sb-hbar-track', trackBg); if (heightAttr) track.style.height = `${toNumber(heightAttr, 12)}px`;
          if (radius) { track.style.borderRadius = radius; }

          // Support stacked segments inside a single row when it.segments is provided
          const segments = Array.isArray(it && it.segments) ? it.segments : null;
          if (segments && segments.length) {
            let accPct = 0;
            let primaryPct = null; // show-only percentage (first segment)
            segments.forEach((seg, idx) => {
              const sval = toNumber(seg && seg.value, 0);
              const scolor = (seg && seg.color) || this.getAttribute('color') || '#16a34a';
              const computed = computePercent(sval, max, percentDecimals, percentRounding);
              const pct = computed.pct;
              const left = accPct;
              const remaining = Math.max(0, 100 - left);
              const width = Math.min(Math.max(0, pct), remaining);
              accPct = Math.min(100, left + width);
              if (idx === 0) primaryPct = width;

              const bar = document.createElement('div'); bar.className='bar'; bar.style.setProperty('--sb-hbar-color', scolor);
              if (striped) bar.classList.add('striped'); if (animated) bar.classList.add('animated');
              bar.style.width = width + '%';
              bar.style.left = left + '%';
              if (radius) { bar.style.borderRadius = radius; }
              bar.setAttribute('role','progressbar');
              bar.setAttribute('aria-valuemin','0');
              bar.setAttribute('aria-valuemax', String(max));
              bar.setAttribute('aria-valuenow', String(sval));
              const segLabel = (seg && (seg.label ?? seg.nome ?? seg.name)) || '';
              bar.setAttribute('aria-label', segLabel || 'Segmento');
              if (showPercent) {
                const tip = document.createElement('div'); tip.className='tooltip'; tip.textContent = `${formatPercent(width, percentDecimals)}${unit || '%'}`; bar.appendChild(tip);
              }
              track.appendChild(bar);
            });
            row.appendChild(lab);
            row.appendChild(track);
            if (showPercent) {
              const val = document.createElement('div'); val.className='val'; val.setAttribute('part','value');
              const p = (primaryPct == null) ? Math.min(accPct, 100) : primaryPct;
              val.textContent = `${formatPercent(p, percentDecimals)}${unit || '%'}`;
              row.appendChild(val);
            }
            this._wrap.appendChild(row);
          } else {
            // Default single bar per row
            const value = toNumber(it && it.value, 0);
            const color = (it && it.color) || this.getAttribute('color') || '#16a34a';
            const computed = computePercent(value, max, percentDecimals, percentRounding);
            const pct = computed.pct;
            const bar = document.createElement('div'); bar.className='bar'; bar.style.setProperty('--sb-hbar-color', color);
            if (striped) bar.classList.add('striped'); if (animated) bar.classList.add('animated');
            bar.style.width = pct + '%';
            if (radius) { bar.style.borderRadius = radius; }
            bar.setAttribute('role','progressbar');
            bar.setAttribute('aria-valuemin','0');
            bar.setAttribute('aria-valuemax', String(max));
            bar.setAttribute('aria-valuenow', String(value));
            bar.setAttribute('aria-label', label || 'Barra');
            const val = document.createElement('div'); val.className='val'; val.setAttribute('part','value');
            val.textContent = showPercent ? `${formatPercent(pct, percentDecimals)}${unit || '%'}` : `${value}${unit}`;
            if (showPercent) { const tip = document.createElement('div'); tip.className='tooltip'; tip.textContent = `${formatPercent(pct, percentDecimals)}${unit || '%'}`; bar.appendChild(tip); }
            track.appendChild(bar);
            row.appendChild(lab);
            row.appendChild(track);
            row.appendChild(val);
            this._wrap.appendChild(row);
          }
        });
      } else {
        const label = this.getAttribute('label') || '';
        const value = toNumber(this.getAttribute('value'), 0);
        const max = toNumber(this.getAttribute('max'), 100);
        const unit = this.getAttribute('unit') || '';
        const color = this.getAttribute('color') || '#16a34a';
        const trackBg = bg || '#e5e7eb';
        const computed = computePercent(value, max, percentDecimalsAttr, percentRoundingAttr);
        const pct = computed.pct;

        const row = document.createElement('div'); row.className='row'; row.setAttribute('part','row');
        const lab = document.createElement('div'); lab.className='label'; lab.textContent = label; lab.setAttribute('part','label');
        const track = document.createElement('div'); track.className='track'; track.style.setProperty('--sb-hbar-track', trackBg); if (heightAttr) track.style.height = `${toNumber(heightAttr, 12)}px`;
        if (radius) { track.style.borderRadius = radius; }
        const bar = document.createElement('div'); bar.className='bar'; bar.style.setProperty('--sb-hbar-color', color);
        if (striped) bar.classList.add('striped'); if (animated) bar.classList.add('animated');
        bar.style.width = pct + '%';
        if (radius) { bar.style.borderRadius = radius; }
        bar.setAttribute('role','progressbar');
        bar.setAttribute('aria-valuemin','0');
        bar.setAttribute('aria-valuemax', String(max));
        bar.setAttribute('aria-valuenow', String(value));
        bar.setAttribute('aria-label', label || 'Barra');

        const val = document.createElement('div'); val.className='val'; val.setAttribute('part','value');
        val.textContent = showPercent ? `${formatPercent(pct, percentDecimalsAttr)}${unit || '%'}` : `${value}${unit}`;
        if (showPercent) { const tip = document.createElement('div'); tip.className='tooltip'; tip.textContent = `${formatPercent(pct, percentDecimalsAttr)}${unit || '%'}`; bar.appendChild(tip); }

        track.appendChild(bar);
        row.appendChild(lab);
        row.appendChild(track);
        row.appendChild(val);
        this._wrap.appendChild(row);
      }
    }
  }

  if (!window.customElements.get('sb-hbar')){
    window.customElements.define('sb-hbar', SBHBar);
  }
})();
