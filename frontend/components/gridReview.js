(function () {
  // Hard no-cache mode: remove any existing Service Worker + Cache Storage.
  // Review pages may not load frontend/script.js, so we enforce cleanup here too.
  (async () => {
    let wasControlled = false;
    try { wasControlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (_) {}

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all((regs || []).map((r) => {
          try { return r.unregister(); } catch (_) { return Promise.resolve(false); }
        }));
      }
    } catch (_) {}

    try {
      if (window.caches && caches.keys) {
        const names = await caches.keys();
        await Promise.all((names || []).map((n) => {
          try { return caches.delete(n); } catch (_) { return Promise.resolve(false); }
        }));
      }
    } catch (_) {}

    // If the page was under SW control, reload once to drop interception.
    try {
      if (wasControlled) {
        const k = '__swKillReloadAt';
        const last = localStorage.getItem(k);
        const now = Date.now();
        const lastMs = last ? Date.parse(last) : NaN;
        const recently = Number.isFinite(lastMs) && (now - lastMs) < (10 * 60 * 1000);
        if (!recently) {
          localStorage.setItem(k, new Date(now).toISOString());
          setTimeout(() => {
            try { window.location.reload(); } catch (_) {}
          }, 60);
        }
      }
    } catch (_) {}
  })();

  function ensureStyles() {
    if (document.getElementById('gridReviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'gridReviewStyles';
    style.textContent = `
      .grid-review__filters{ display:flex; flex-wrap:wrap; gap:10px 12px; align-items:flex-end; margin-bottom:10px; }
      .grid-review__filter{ display:flex; flex-direction:column; gap:4px; }
      .grid-review__filter label{ font-size:12px; font-weight:700; color:#334155; }
      .grid-review__filter select{ padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px; background:#ffffff; color:#0f172a; font-size:13px; }
      .grid-review{ display:flex; flex-wrap:wrap; gap:8px; }
      .grid-review__item{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff; color:#0f172a; font-weight:700; font-size:14px; cursor:pointer; }
      .grid-review__item:hover{ filter:brightness(0.98); }
      .grid-review__item--correct{ background:#095306; border-color:#095306; color:#ffffff; }
      .grid-review__item--wrong{ color:#991b1b; border-color:#fecaca; background:#ffffff; }
      .grid-review__item--neutral{ color:#475569; border-color:#cbd5e1; background:#f1f5f9; }
    `;
    document.head.appendChild(style);
  }

  function normalizeOptions(question) {
    const raw = question && (question.opcoes || question.options);
    return Array.isArray(raw) ? raw : [];
  }

  function textFromHtml(html) {
    try {
      const div = document.createElement('div');
      div.innerHTML = html == null ? '' : String(html);
      const t = (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
      return t;
    } catch (_) {
      return '';
    }
  }

  function questionHint(question) {
    const raw = question && (question.descricao || question.text || question.enunciado || '');
    const t = textFromHtml(raw);
    if (!t) return '';
    const max = 220;
    return t.length > max ? (t.slice(0, max - 1) + '…') : t;
  }

  function answerKey(question, idx) {
    if (question && question.id != null) return 'q_' + question.id;
    return 'idx_' + idx;
  }

  function selectedIdsFromAnswer(ans) {
    if (!ans || typeof ans !== 'object') return [];
    if (Array.isArray(ans.optionIds)) return ans.optionIds;
    if (ans.optionId != null) return [ans.optionId];
    // Typed/interaction answers: treat as answered for filter purposes.
    if (ans.response != null) return ['__typed__'];
    return [];
  }

  function isMatchColumns(question) {
    try {
      const t = (question && (question.type || question.tiposlug)) ? String(question.type || question.tiposlug).trim().toLowerCase() : '';
      return t === 'match_columns';
    } catch (_) {
      return false;
    }
  }

  function pairsFromAnswer(ans) {
    try {
      if (!ans || typeof ans !== 'object') return null;
      const r = ans.response;
      if (!r) return null;
      if (typeof r === 'string') {
        const s = r.trim();
        if (!s) return null;
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === 'object' && parsed.pairs && typeof parsed.pairs === 'object') return parsed.pairs;
          if (parsed && typeof parsed === 'object') return parsed;
          return null;
        } catch (_) {
          return null;
        }
      }
      if (r && typeof r === 'object' && r.pairs && typeof r.pairs === 'object') return r.pairs;
      if (r && typeof r === 'object') return r;
      return null;
    } catch (_) {
      return null;
    }
  }

  function computeMatchColumnsCorrectness(question, ans) {
    try {
      const correctPairs = (question && question.correctPairs && typeof question.correctPairs === 'object') ? question.correctPairs : null;
      const userPairs = pairsFromAnswer(ans);
      if (!correctPairs || !Object.keys(correctPairs).length) return null;
      if (!userPairs || !Object.keys(userPairs).length) return null;

      // Must match all left keys present in correctPairs
      for (const lid of Object.keys(correctPairs)) {
        const ur = userPairs[lid];
        const cr = correctPairs[lid];
        if (ur == null || String(ur).trim() === '') return false;
        if (String(ur) !== String(cr)) return false;
      }

      // one-to-one by default unless explicitly false in interacao
      const oneToOne = !((question && question.interacao && question.interacao.oneToOne) === false);
      if (oneToOne) {
        const seen = new Set();
        for (const lid of Object.keys(correctPairs)) {
          const rid = String(userPairs[lid]);
          if (seen.has(rid)) return false;
          seen.add(rid);
        }
      }
      return true;
    } catch (_) {
      return null;
    }
  }

  function computeCorrectness(question, selectedIds, ans) {
    if (isMatchColumns(question)) {
      const v = computeMatchColumnsCorrectness(question, ans);
      if (v === true || v === false) return v;
      // If answered but cannot compute, keep neutral
      return null;
    }
    const opts = normalizeOptions(question);
    // Normalize IDs to strings to avoid number-vs-string mismatches coming from API serialization.
    const correctIds = opts
      .filter((o) => o && (o.correta || o.isCorrect))
      .map((o) => (o && o.id != null) ? String(o.id) : null)
      .filter((id) => id != null);

    if (!correctIds.length) return null;
    if (!selectedIds || !selectedIds.length) return null;

    const selSet = new Set((selectedIds || []).map((id) => String(id)));
    const corSet = new Set((correctIds || []).map((id) => String(id)));
    if (selSet.size !== corSet.size) return false;

    for (const id of corSet) if (!selSet.has(id)) return false;
    for (const id of selSet) if (!corSet.has(id)) return false;
    return true;
  }

  function domainIdFromQuestion(question) {
    try {
      const direct = (question && (question.iddominiogeral ?? question.id_dominio_geral ?? question.idDominioGeral ?? question.id_dominioGeral));
      const nested = question && question.dominio && (question.dominio.id ?? question.dominio.iddominiogeral);
      const v = (direct != null) ? direct : nested;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  function desempenhoDominioIdFromQuestion(question) {
    try {
      const direct = (question && (question.iddominio_desempenho ?? question.idDominioDesempenho ?? question.id_dominio_desempenho));
      const nested = question && question.dominio && (question.dominio.id ?? question.dominio.Id);
      const v = (direct != null) ? direct : nested;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  function desempenhoDominioDescricaoFromQuestion(question) {
    try {
      const d = question && question.dominio;
      const desc = (d && (d.descricao || d.Descricao)) || question.dominioDescricao;
      const s = desc != null ? String(desc).trim() : '';
      return s || null;
    } catch (_) {
      return null;
    }
  }

  function domainLabelFromId(id) {
    if (id === 1) return '1 - Pessoas';
    if (id === 2) return '2 - Processos';
    if (id === 3) return '3 - Ambiente de Negócios';
    return String(id);
  }

  function mount(opts) {
    try {
      ensureStyles();
      const host = typeof opts.host === 'string' ? document.getElementById(opts.host) : opts.host;
      if (!host) return;

      const questions = Array.isArray(opts.questions) ? opts.questions : [];
      const answers = (opts.answers && typeof opts.answers === 'object') ? opts.answers : {};
      const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;

      host.innerHTML = '';

      // Filters
      const filtersWrap = document.createElement('div');
      filtersWrap.className = 'grid-review__filters';

      const filterStatusWrap = document.createElement('div');
      filterStatusWrap.className = 'grid-review__filter';
      const filterStatusLabel = document.createElement('label');
      filterStatusLabel.textContent = 'Filtro 1: Respostas';
      const filterStatus = document.createElement('select');
      filterStatus.innerHTML = `
        <option value="all">Todas</option>
        <option value="answered">Respondidas</option>
        <option value="unanswered">Não respondidas</option>
        <option value="correct">Respondidas corretamente</option>
        <option value="wrong">Respondidas incorretamente</option>
      `;
      filterStatusWrap.appendChild(filterStatusLabel);
      filterStatusWrap.appendChild(filterStatus);

      const filterDomainWrap = document.createElement('div');
      filterDomainWrap.className = 'grid-review__filter';
      const filterDomainLabel = document.createElement('label');
      filterDomainLabel.textContent = 'Filtro 2: Domínio';
      const filterDomain = document.createElement('select');
      filterDomain.innerHTML = `
        <option value="all">Todos</option>
        <option value="1">1 - Pessoas</option>
        <option value="2">2 - Processos</option>
        <option value="3">3 - Ambiente de Negócios</option>
      `;
      filterDomainWrap.appendChild(filterDomainLabel);
      filterDomainWrap.appendChild(filterDomain);

      const filterAreaWrap = document.createElement('div');
      filterAreaWrap.className = 'grid-review__filter';
      const filterAreaLabel = document.createElement('label');
      filterAreaLabel.textContent = 'Filtro 3: Domínio de desempenho';
      const filterArea = document.createElement('select');
      filterArea.appendChild(new Option('Todas', 'all'));

      async function loadDominiosDesempenho() {
        try {
          const r = await fetch('/api/meta/ddesempenho', { method: 'GET' });
          if (!r.ok) return;
          const rows = await r.json().catch(() => null);
          if (!Array.isArray(rows)) return;

          const items = rows
            .map((it) => {
              const id = Number(it && (it.id ?? it.Id ?? it.CodAreaConhecimento ?? it.codareaconhecimento));
              const descricao = (it && (it.descricao ?? it.Descricao)) != null ? String(it.descricao ?? it.Descricao).trim() : '';
              return { id: Number.isFinite(id) ? id : null, descricao };
            })
            .filter((it) => it.id != null && it.descricao);

          // Rebuild options keeping the first "Todas"
          filterArea.options.length = 0;
          filterArea.appendChild(new Option('Todas', 'all'));
          items
            .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
            .forEach((it) => {
              filterArea.appendChild(new Option(it.descricao, String(it.id)));
            });
        } catch (_) {
          // ignore
        }
      }
      filterAreaWrap.appendChild(filterAreaLabel);
      filterAreaWrap.appendChild(filterArea);

      filtersWrap.appendChild(filterStatusWrap);
      filtersWrap.appendChild(filterDomainWrap);
      filtersWrap.appendChild(filterAreaWrap);
      host.appendChild(filtersWrap);

      const grid = document.createElement('div');
      grid.className = 'grid-review';

      function renderGrid() {
        grid.innerHTML = '';

        const statusVal = String(filterStatus.value || 'all');
        const domainVal = String(filterDomain.value || 'all');
        const areaVal = String(filterArea.value || 'all');

        questions.forEach((q, idx) => {
          const key = answerKey(q, idx);
          const ans = answers[key] || {};
          const selectedIds = selectedIdsFromAnswer(ans);
          const isAnswered = !!(selectedIds && selectedIds.length);
          const correctness = computeCorrectness(q, selectedIds, ans);

          // Filtro 1
          if (statusVal === 'answered' && !isAnswered) return;
          if (statusVal === 'unanswered' && isAnswered) return;
          if (statusVal === 'correct' && correctness !== true) return;
          if (statusVal === 'wrong' && correctness !== false) return;

          // Filtro 2 (Domínio / dominiogeral)
          if (domainVal !== 'all') {
            const did = domainIdFromQuestion(q);
            if (did == null || String(did) !== domainVal) return;
          }

          // Filtro 3 (Área de conhecimento)
          if (areaVal !== 'all') {
            const did = desempenhoDominioIdFromQuestion(q);
            if (did == null || String(did) !== areaVal) return;
          }

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'grid-review__item';
          if (correctness === true) btn.classList.add('grid-review__item--correct');
          else if (correctness === false) btn.classList.add('grid-review__item--wrong');
          else btn.classList.add('grid-review__item--neutral');

          // Mantém numeração original
          btn.textContent = String(idx + 1);
          try {
            const hint = questionHint(q);
            const did = domainIdFromQuestion(q);
            const ddLabel = desempenhoDominioDescricaoFromQuestion(q);
            const parts = [];
            if (hint) parts.push(hint);
            if (did != null) parts.push('Domínio: ' + domainLabelFromId(did));
            if (ddLabel) parts.push('Desempenho: ' + ddLabel);
            const title = parts.filter(Boolean).join('\n\n');
            if (title) btn.title = title;
          } catch (_) {}

          btn.addEventListener('click', () => {
            try {
              if (onSelect) onSelect(idx);
            } catch (_) {}
          });

          grid.appendChild(btn);
        });
      }

      filterStatus.addEventListener('change', renderGrid);
      filterDomain.addEventListener('change', renderGrid);
      filterArea.addEventListener('change', renderGrid);

      host.appendChild(grid);
      renderGrid();

      // Load areas list after initial render
      loadDominiosDesempenho();
    } catch (_) {
      // no-op
    }
  }

  window.gridReview = { mount };
})();
