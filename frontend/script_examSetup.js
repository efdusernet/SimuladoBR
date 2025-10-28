// script_examSetup.js
// Handles the redesigned exam setup modal: loads meta lists, enforces single-tab selection,
// applies BloqueioAtivado UI cap, posts to /api/exams/select and redirects to exam.html.

// script_examSetup.js
// Handles the redesigned exam setup modal: loads meta lists, enforces single-tab selection,
// applies BloqueioAtivado UI cap, posts to /api/exams/select and redirects to exam.html.

(function(){
  // small helpers
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

  let meta = { areas: [], grupos: [], dominios: [] };
  let activeTab = null;
  let bloqueioActive = (localStorage.getItem('BloqueioAtivado') === 'true');

  async function fetchMeta() {
    try {
      const base = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) ? (new URL(window.SIMULADOS_CONFIG.BACKEND_BASE, window.location.href).origin) : '';
      const urls = [`${base}/api/meta/areas`, `${base}/api/meta/grupos`, `${base}/api/meta/dominios`];
      const results = await Promise.all(urls.map(async u => {
        try {
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) return { ok: false, status: r.status, body: null };
          const j = await r.json();
          return { ok: true, body: j };
        } catch (e) { return { ok: false, status: 0, body: null, err: e && e.message } }
      }));

      function normalizeList(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.map(it => ({ id: (it && (it.id || it.Id || it.ID || it.IdArea || it.IdAreaConhecimento)) || null,
                                 descricao: (it && (it.descricao || it.Descricao || it.nome || it.Nome || it.label || it.Label)) || String(it && (it.id || it.Id) || '') }));
      }

      const a = results[0]; const g = results[1]; const d = results[2];
      if (a && a.ok) meta.areas = normalizeList(a.body); else meta.areas = [];
      if (g && g.ok) meta.grupos = normalizeList(g.body); else meta.grupos = [];
      if (d && d.ok) meta.dominios = normalizeList(d.body); else meta.dominios = [];

      // surface debug info in modal if any fetch failed
      const debugMsg = [];
      if (a && !a.ok) debugMsg.push(`areas:${a.status || 'err'}`);
      if (g && !g.ok) debugMsg.push(`grupos:${g.status || 'err'}`);
      if (d && !d.ok) debugMsg.push(`dominios:${d.status || 'err'}`);
      const dbgEl = document.getElementById('examSetupMetaDebug');
      if (dbgEl) dbgEl.textContent = debugMsg.length ? `Erro ao carregar meta: ${debugMsg.join(', ')}` : '';

      // If meta endpoints returned no items (or failed), provide a sensible fallback so the UI isn't empty.
      const allEmpty = (!meta.dominios.length && !meta.grupos.length && !meta.areas.length);
      if (allEmpty) {
        console.warn('meta endpoints returned empty; using fallback example lists');
        // fallback lists matching expected counts from requirements
        meta.dominios = [
          { id: 1, descricao: 'Partes Interessadas' },
          { id: 2, descricao: 'Equipe' },
          { id: 3, descricao: 'Abordagem de Desenvolvimento e Ciclo de Vida' },
          { id: 4, descricao: 'Planejamento' },
          { id: 5, descricao: 'Trabalho do Projeto' },
          { id: 6, descricao: 'Entrega' },
          { id: 7, descricao: 'Medição' },
          { id: 8, descricao: 'Incertezas' }
        ];
        meta.grupos = [
          { id: 1, descricao: 'Iniciação' },
          { id: 2, descricao: 'Planejamento' },
          { id: 3, descricao: 'Execução' },
          { id: 4, descricao: 'Monitoramento e Controle' },
          { id: 5, descricao: 'Encerramento' }
        ];
        meta.areas = [
          { id: 1, descricao: 'Integração' },
          { id: 2, descricao: 'Escopo' },
          { id: 3, descricao: 'Cronograma' },
          { id: 4, descricao: 'Custos' },
          { id: 5, descricao: 'Qualidade' },
          { id: 6, descricao: 'Recursos' },
          { id: 7, descricao: 'Comunicações' },
          { id: 8, descricao: 'Riscos' },
          { id: 9, descricao: 'Aquisições' },
          { id: 10, descricao: 'Partes Interessadas' },
          { id: 11, descricao: 'Outra Área' }
        ];
      }
    } catch (e) { console.warn('fetchMeta failed', e); }
  }

  // Render checklist as clickable tiles into #checklist for the given tab
  const selections = { dominios: [], grupos: [], areas: [] }; // store selected ids

  function renderChecklistFor(tab) {
    const checklist = document.getElementById('checklist');
    checklist.innerHTML = '';
    const items = (tab === 'areas') ? meta.areas : (tab === 'grupos' ? meta.grupos : meta.dominios);
    if (!items || !items.length) {
      checklist.innerHTML = '<div style="color:#666">Nenhum item disponível</div>';
      return;
    }
    items.forEach(it => {
      const id = String(it.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'check-btn';
      btn.dataset.id = id;
      btn.textContent = it.descricao || id;
      // mark active if selected
      if (selections[tab].indexOf(Number(id)) >= 0) btn.classList.add('active');
      btn.addEventListener('click', () => {
        // toggle selection
        const idx = selections[tab].indexOf(Number(id));
        if (idx >= 0) { selections[tab].splice(idx,1); btn.classList.remove('active'); }
        else { selections[tab].push(Number(id)); btn.classList.add('active'); }
        updateResumo();
        validateForm();
      });
      checklist.appendChild(btn);
    });
  }

  function showTab(tab) {
    if (!tab) return;
    // when switching, clear selections of previous tab (per requirement)
    if (activeTab && activeTab !== tab) {
      selections[activeTab] = [];
    }
    activeTab = tab;
    // tabs UI
    document.querySelectorAll('.tab').forEach(t => {
      if (t.dataset.aba === tab) t.classList.add('active'); else t.classList.remove('active');
    });
    // render checklist for active tab
    renderChecklistFor(tab);
    updateResumo();
    validateForm();
  }

  function getSelectedIdsForActiveTab() { return selections[activeTab] ? selections[activeTab].slice() : []; }

  function getCountValue() { const v = Number((document.getElementById('quantidade')||{value:''}).value); return Number.isFinite(v) ? v : 0; }

  function setError(msg){ const e = $('#errorMsg'); if (!e) return; if (!msg) { e.style.display='none'; e.textContent=''; } else { e.style.display='block'; e.textContent=msg; } }

  function validateForm(){
    const btn = $('#startExamBtn'); if (!btn) return;
    const count = getCountValue();
    const hasFilterSelection = (getSelectedIdsForActiveTab() || []).length > 0;

    // If no count and no filters, ask the user to fill at least one
    if (!count || count < 1) {
      if (hasFilterSelection) {
        // allow filters-only start; server will decide how many and can return availability prompts
        btn.disabled = false; setError(null); return true;
      } else {
        btn.disabled = true; setError('Informe a quantidade de questões (mínimo 1) ou selecione focos.'); return false;
      }
    }

    // If a count is provided, enforce limits
    if (count > 180) { btn.disabled = true; setError('A quantidade deve ser no máximo 180.'); return false; }
    if (bloqueioActive && count > 25) { btn.disabled = true; setError('Seu plano limita a 25 questões. Reduza para prosseguir.'); return false; }

    btn.disabled = false; setError(null); return true;
  }

  async function ensureBloqueio() {
    // attempt to refresh BloqueioAtivado from server when possible
    try {
      const token = localStorage.getItem('sessionToken') || '';
      if (!token || token.endsWith('#')) return; // guest
      const resp = await fetch('/api/auth/me', { headers: { 'X-Session-Token': token } });
      if (!resp.ok) return;
      const j = await resp.json();
      if (j && typeof j.BloqueioAtivado !== 'undefined') {
        bloqueioActive = Boolean(j.BloqueioAtivado);
        try { localStorage.setItem('BloqueioAtivado', bloqueioActive ? 'true' : 'false'); } catch(e){}
      }
    } catch(e) { /* ignore */ }
  }

  async function onStart(ev){
    console.debug('[examSetup] onStart called', {event: !!ev, activeTab, count: getCountValue()});
    try {
      if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    } catch(e){}
    ev && ev.preventDefault && ev.preventDefault();
    // validate again
    if (!validateForm()) return;
    let count = getCountValue();
    const sel = getSelectedIdsForActiveTab();
    const hasFilterSelection = (sel || []).length > 0;
    // If user selected filters but left quantity empty, request up to user's cap
    if ((!count || count < 1) && hasFilterSelection) {
      count = bloqueioActive ? 25 : 180;
    }
    const payload = {};
    if (count && count > 0) payload.count = count;
    if (activeTab === 'areas') payload.codareaconhecimento = sel;
    else if (activeTab === 'grupos') payload.codgrupoprocesso = sel;
    else if (activeTab === 'dominios') payload.dominios = sel;

    const token = localStorage.getItem('sessionToken') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Session-Token'] = token;

    const startBtn = $('#startExamBtn');
    try { startBtn.disabled = true; startBtn.textContent = 'Iniciando...'; } catch(e){}

    try {
      const resp = await fetch('/api/exams/select', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!resp.ok) {
        // try to parse structured JSON error for friendlier messages
        let body = null;
        try { body = await resp.json(); } catch(e) { /* ignore parse errors */ }
        if (body && typeof body === 'object') {
          // server may send { error: 'Not enough questions available', available: 24 }
          if (typeof body.available === 'number') {
            const avail = Number(body.available);
            const e = document.getElementById('errorMsg');
            if (e) {
              e.style.display = 'block';
              const palavra = (avail === 1) ? 'questão' : 'questões';
              e.innerHTML = `Só existem ${avail} ${palavra} com o filtro aplicado — ajuste a quantidade de questões ou remova filtros. <button type="button" id="adjustAvailableBtn" style="margin-left:8px;padding:6px 8px;border-radius:6px;background:#007bff;color:#fff;border:none;cursor:pointer;">Ajustar para ${avail}</button>`;
              const adj = document.getElementById('adjustAvailableBtn');
              if (adj) adj.addEventListener('click', () => {
                const q = document.getElementById('quantidade'); if (q) { q.value = String(avail); }
                try { updateResumo(); validateForm(); } catch(e){}
                e.style.display = 'none';
              });
            } else {
              const palavra = (avail === 1) ? 'questão' : 'questões';
              setError(`Só existem ${avail} ${palavra} com o filtro aplicado — ajuste a quantidade de questões ou remova filtros.`);
            }
          } else if (body.error || body.message) {
            setError(String(body.error || body.message));
          } else {
            setError(`Falha ao iniciar: ${resp.status}`);
          }
        } else {
          const txt = await resp.text().catch(()=>null);
          setError(`Falha ao iniciar: ${resp.status} ${txt || ''}`);
        }
        startBtn.disabled = false; startBtn.textContent = 'Iniciar Simulado';
        return;
      }
      const data = await resp.json();
      if (!data || !data.sessionId) {
        setError('Resposta inválida do servidor'); startBtn.disabled = false; startBtn.textContent = 'Iniciar Simulado'; return;
      }
      // persist session and questions so exam page can pick them
      try {
        const sid = String(data.sessionId || '');
        localStorage.setItem('currentSessionId', sid);
        if (Array.isArray(data.questions)) {
          const qkey = `questions_${sid}`;
          localStorage.setItem(qkey, JSON.stringify(data.questions));
          localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
        }
        // persist effective count for exam page: user-entered count or number of returned questions
        try {
          const effective = (count && count > 0) ? count : (Array.isArray(data.questions) ? data.questions.length : (Number(data.total) || 0));
          if (effective) localStorage.setItem('examQuestionCount', String(effective));
        } catch(e){}
      } catch(e) { console.warn('failed to persist session/questions', e); }

      // redirect to exam page (use data-exam-url if provided by loader, else default)
      const contEl = document.getElementById('examSetupContainer');
      const examUrl = (contEl && contEl.getAttribute && contEl.getAttribute('data-exam-url')) || '/pages/exam.html';
      // ensure we call before any other handlers (prevent duplicates)
      window.location.href = examUrl;
    } catch (e) {
      setError('Erro de rede ao iniciar o exame');
      startBtn.disabled = false; startBtn.textContent = 'Iniciar Simulado';
    }
  }

  function updateResumo(){
    const qtd = getCountValue();
    if (resumoQtd) resumoQtd.textContent = qtd || '-';
    const selIds = getSelectedIdsForActiveTab() || [];
    let labels = [];
    const items = (activeTab === 'areas') ? meta.areas : (activeTab === 'grupos' ? meta.grupos : meta.dominios);
    if (items && items.length && selIds.length) {
      const map = {};
      items.forEach(it => { map[String(it.id)] = it.descricao; });
      labels = selIds.map(id => map[String(id)] || String(id));
    }
    if (resumoFocos) resumoFocos.textContent = (labels && labels.length) ? labels.join(', ') : 'Todos (aleatório)';
  }

  function wireUi(){
    // populate initial UI state
    // set limit info text
    const limiteTxt = document.getElementById('limite-texto');
    const limiteInfo = document.getElementById('limite-info');
    const qtdInput = document.getElementById('quantidade');
    const maxForUser = bloqueioActive ? 25 : 180;
    if (limiteTxt) limiteTxt.textContent = bloqueioActive ? 'Usuário com bloqueio ativo: limite de 25 questões.' : 'Usuário registrado: limite de 180 questões.';
    if (limiteInfo) limiteInfo.textContent = `(máx. ${maxForUser})`;
    if (qtdInput) { qtdInput.setAttribute('max', String(maxForUser)); }

  // attach tab clicks
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>{ showTab(t.dataset.aba); }));

    // quantity input
    const qtdEl = document.getElementById('quantidade');
    if (qtdEl) qtdEl.addEventListener('input', e => {
      let v = Number(e.target.value) || 0;
      if (v < 1) v = 0;
      if (bloqueioActive && v > 25) { e.target.value = 25; v = 25; }
      if (!bloqueioActive && v > 180) { e.target.value = 180; v = 180; }
      updateResumo(); validateForm();
    });

    // start button
    const startBtn = document.getElementById('startExamBtn'); if (startBtn) startBtn.addEventListener('click', onStart);

    // cancel button
    const cancel = document.getElementById('cancelExamBtn'); if (cancel) cancel.addEventListener('click', ()=>{ const c = document.getElementById('examSetupContainer'); if (c) c.style.display='none'; });

    // show container
    const cont = document.getElementById('examSetupContainer'); if (cont) cont.style.display = 'block';

    // default to dominios tab
    showTab('dominios');
  }

  

  // bootstrap
  (async function boot(){
    try { await ensureBloqueio(); } catch(e){}
    try { await fetchMeta(); } catch(e){}
    try { wireUi(); } catch(e){}
  })();

})();
