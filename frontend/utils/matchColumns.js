(function(){
  function isPlainObject(v){
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  function ensureStyles(){
    try {
      if (document.getElementById('mc-style')) return;
      const st = document.createElement('style');
      st.id = 'mc-style';
      st.textContent = `
        .mc-toolbar{ display:flex; align-items:center; justify-content:flex-end; gap:10px; margin:6px 0 10px; }
        .mc-btn{ border:1px solid #0f172a; background:#fff; color:#0f172a; border-radius:10px; padding:8px 10px; font-size:.85rem; font-weight:700; cursor:pointer; }
        .mc-btn:hover{ background:#f1f5f9; }
        .mc-btn:active{ transform: translateY(1px); }
        .mc-wrap{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-top:10px; }
        .mc-col{ background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:10px; }
        .mc-col h4{ margin:0 0 8px; font-size:.92rem; color:#111827; }
        .mc-row{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; align-items:center; padding:8px; border-radius:10px; border:1px dashed #e5e7eb; margin-bottom:8px; }
        .mc-left{ font-weight:600; color:#111827; font-size:.95rem; }
        .mc-slot{ min-height:40px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-radius:10px; border:1px solid #cbd5e1; background:#f8fafc; }
        .mc-slot.drop-hover{ outline:2px solid #60a5fa; outline-offset:2px; }
        .mc-slot .mc-slot-text{ color:#0f172a; font-size:.92rem; }
        .mc-slot .mc-clear{ border:0; background:transparent; color:#64748b; cursor:pointer; font-size:.85rem; }
        .mc-right-item{ padding:8px 10px; border-radius:10px; border:2px solid #0f172a; background:#d1fae5; cursor:grab; user-select:none; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:8px; box-shadow: 0 1px 0 rgba(15,23,42,.12); }
        .mc-right-item:hover{ filter: brightness(0.98); }
        .mc-right-item.used{ opacity:.45; cursor:not-allowed; }
        .mc-right-item.selected{ outline:3px solid #2563eb; outline-offset:2px; }
        .mc-badge{ font-size:.75rem; color:#64748b; }
        .mc-help{ margin-top:8px; font-size:.82rem; color:#64748b; }
      `;
      document.head.appendChild(st);
    } catch(_){ }
  }

  function clonePairs(pairs){
    const out = {};
    if (!isPlainObject(pairs)) return out;
    for (const k of Object.keys(pairs)) out[String(k)] = pairs[k] == null ? null : String(pairs[k]);
    return out;
  }

  function createMatchColumns(host, spec, opts){
    ensureStyles();
    opts = opts || {};
    const mode = (opts.mode || 'exam');
    const oneToOne = (spec && spec.oneToOne != null) ? !!spec.oneToOne : true;
    const shuffleRight = (spec && spec.shuffleRight != null) ? !!spec.shuffleRight : true;

    const left = Array.isArray(spec && spec.left) ? spec.left : [];
    const right = Array.isArray(spec && spec.right) ? spec.right : [];

    const rightById = new Map(right.map(r => [String(r.id), r]));

    // session-stable right order: allow caller to pass order; else shuffle if requested
    let rightOrder = right.slice();
    if (shuffleRight && mode === 'exam') {
      try {
        // Fisher-Yates
        for (let i = rightOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = rightOrder[i]; rightOrder[i] = rightOrder[j]; rightOrder[j] = tmp;
        }
      } catch(_){ }
    }

    let pairs = clonePairs(opts.valuePairs);
    let selectedRightId = null; // click-to-pair fallback

    function resetAll(){
      pairs = {};
      selectedRightId = null;
      emit();
      render();
    }

    function usedRightIds(){
      const s = new Set();
      for (const v of Object.values(pairs)) if (v != null && String(v).trim() !== '') s.add(String(v));
      return s;
    }

    function emit(){
      try { if (typeof opts.onChange === 'function') opts.onChange({ pairs: clonePairs(pairs) }); } catch(_){ }
    }

    function assign(leftId, rightId){
      const lid = String(leftId);
      const rid = String(rightId);
      if (!rightById.has(rid)) return;

      if (oneToOne) {
        // remove from any other left
        for (const k of Object.keys(pairs)) {
          if (String(pairs[k]) === rid) pairs[k] = null;
        }
      }
      pairs[lid] = rid;
      emit();
      render();
    }

    function clear(leftId){
      const lid = String(leftId);
      if (pairs[lid] == null) return;
      pairs[lid] = null;
      emit();
      render();
    }

    function render(){
      if (!host) return;
      const used = usedRightIds();

      const toolbar = document.createElement('div');
      toolbar.className = 'mc-toolbar';
      if (mode !== 'review') {
        const btnReset = document.createElement('button');
        btnReset.type = 'button';
        btnReset.className = 'mc-btn';
        btnReset.textContent = (opts.resetLabel || 'Reset');
        btnReset.title = 'Limpar todos os pareamentos';
        btnReset.addEventListener('click', (e)=>{ e.preventDefault(); resetAll(); });
        toolbar.appendChild(btnReset);
      }

      const wrap = document.createElement('div');
      wrap.className = 'mc-wrap';

      const colLeft = document.createElement('div');
      colLeft.className = 'mc-col';
      const hL = document.createElement('h4');
      hL.textContent = opts.leftTitle || 'Coluna A';
      colLeft.appendChild(hL);

      left.forEach(item => {
        const lid = String(item.id);
        const row = document.createElement('div');
        row.className = 'mc-row';

        const leftCell = document.createElement('div');
        leftCell.className = 'mc-left';
        leftCell.textContent = item.text || '';

        const slot = document.createElement('div');
        slot.className = 'mc-slot';
        slot.dataset.leftId = lid;
        slot.tabIndex = 0;

        const chosenRid = pairs[lid] != null ? String(pairs[lid]) : '';
        const chosen = chosenRid ? rightById.get(chosenRid) : null;

        const slotText = document.createElement('span');
        slotText.className = 'mc-slot-text';
        slotText.textContent = chosen ? (chosen.text || '') : (opts.emptyText || 'Arraste aqui ou clique para selecionar');
        slot.appendChild(slotText);

        const btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.className = 'mc-clear';
        btnClear.textContent = chosen ? 'Limpar' : '';
        btnClear.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); clear(lid); });
        slot.appendChild(btnClear);

        if (mode !== 'review') {
          slot.addEventListener('dragover', (e)=>{ e.preventDefault(); slot.classList.add('drop-hover'); });
          slot.addEventListener('dragleave', ()=>{ slot.classList.remove('drop-hover'); });
          slot.addEventListener('drop', (e)=>{
            e.preventDefault();
            slot.classList.remove('drop-hover');
            const rid = e.dataTransfer ? e.dataTransfer.getData('text/mc-right-id') : '';
            if (!rid) return;
            assign(lid, rid);
          });

          slot.addEventListener('click', ()=>{
            if (!selectedRightId) return;
            assign(lid, selectedRightId);
            selectedRightId = null;
          });

          slot.addEventListener('keydown', (e)=>{
            if (e.key === 'Enter' || e.key === ' ') {
              if (!selectedRightId) return;
              e.preventDefault();
              assign(lid, selectedRightId);
              selectedRightId = null;
            }
          });
        }

        row.appendChild(leftCell);
        row.appendChild(slot);
        colLeft.appendChild(row);
      });

      const colRight = document.createElement('div');
      colRight.className = 'mc-col';
      const hR = document.createElement('h4');
      hR.textContent = opts.rightTitle || 'Coluna B';
      colRight.appendChild(hR);

      rightOrder.forEach(item => {
        const rid = String(item.id);
        const el = document.createElement('div');
        el.className = 'mc-right-item' + (used.has(rid) ? ' used' : '');
        el.draggable = (mode !== 'review') && !used.has(rid);
        el.dataset.rightId = rid;

        const txt = document.createElement('div');
        txt.textContent = item.text || '';

        const badge = document.createElement('div');
        badge.className = 'mc-badge';
        badge.textContent = used.has(rid) ? 'usado' : '';

        el.appendChild(txt);
        el.appendChild(badge);

        if (mode !== 'review') {
          el.addEventListener('dragstart', (e)=>{
            if (used.has(rid)) { try { e.preventDefault(); } catch(_){}; return; }
            try {
              if (e.dataTransfer) {
                e.dataTransfer.setData('text/mc-right-id', rid);
                e.dataTransfer.effectAllowed = 'move';
              }
            } catch(_){ }
          });

          el.addEventListener('click', ()=>{
            if (used.has(rid)) return;
            selectedRightId = (selectedRightId === rid) ? null : rid;
            render();
          });
        }

        if (selectedRightId === rid) el.classList.add('selected');
        colRight.appendChild(el);
      });

      wrap.appendChild(colLeft);
      wrap.appendChild(colRight);

      const help = document.createElement('div');
      help.className = 'mc-help';
      help.textContent = (mode === 'review')
        ? (opts.reviewHelp || '')
        : (opts.helpText || 'Dica: arraste itens da Coluna B para os espaços da Coluna A. Alternativa: clique em um item da Coluna B e depois clique no espaço correspondente.');

      const root = document.createElement('div');
      if (toolbar.childNodes && toolbar.childNodes.length) root.appendChild(toolbar);
      root.appendChild(wrap);
      if (help.textContent) root.appendChild(help);

      try { host.replaceChildren(root); } catch(_){ host.innerHTML = ''; host.appendChild(root); }
    }

    render();

    return {
      getValue: ()=>({ pairs: clonePairs(pairs) }),
      setValue: (v)=>{ pairs = clonePairs(isPlainObject(v) ? (v.pairs || v) : {}); render(); },
      reset: ()=> resetAll(),
      destroy: ()=>{ try { host.replaceChildren(); } catch(_){ host.innerHTML=''; } },
    };
  }

  // Global export
  window.MatchColumns = {
    create: createMatchColumns,
  };
})();
