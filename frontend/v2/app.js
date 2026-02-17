(function(){
  function qs(sel){ return document.querySelector(sel); }

  function getBackendBase(){
    try {
      const origin = String((window.location && window.location.origin) || '').trim();
      const base = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || origin;
      return String(base || origin || '').trim().replace(/\/$/, '');
    } catch(_){
      return '';
    }
  }

  function buildHeaders(){
    try {
      if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
        return window.Auth.getAuthHeaders({ acceptJson: true });
      }
    } catch(_){ }
    return { 'Accept': 'application/json' };
  }

  function getQueryExam(){
    try {
      const p = new URLSearchParams(window.location.search || '');
      const ex = String(p.get('exam') || '').trim();
      return ex || null;
    } catch(_){ return null; }
  }

  function setSelectedExamId(examId){
    try { localStorage.setItem('selectedExamId', String(examId || '')); } catch(_){ }
  }

  function getSelectedExamId(){
    try {
      const v = String(localStorage.getItem('selectedExamId') || '').trim();
      return v || null;
    } catch(_){ return null; }
  }

  function setStatus(title, sub, kind){
    const titleEl = qs('#statusTitle');
    const subEl = qs('#statusSub');
    const dot = qs('#statusDot');
    if (titleEl) titleEl.textContent = String(title || '');
    if (subEl) subEl.textContent = String(sub || '');
    if (dot) {
      dot.classList.remove('warn');
      dot.classList.remove('err');
      if (kind === 'warn') dot.classList.add('warn');
      if (kind === 'err') dot.classList.add('err');
    }
  }

  function setExamPill(examId){
    const pill = qs('#pillExam');
    if (pill) pill.textContent = examId ? String(examId) : '—';
  }

  function setBrandSub(text){
    const el = qs('#brandSub');
    if (el) el.textContent = String(text || 'UI v2');
  }

  function mountNav(){
    const items = Array.from(document.querySelectorAll('.nav-item'));
    function syncActive(){
      const h = String(window.location.hash || '#/');
      for (const it of items) {
        const r = String(it.getAttribute('data-route') || '');
        it.classList.toggle('active', r === h);
      }
    }
    for (const it of items) {
      it.addEventListener('click', () => {
        const r = String(it.getAttribute('data-route') || '#/');
        window.location.hash = r;
      });
    }
    window.addEventListener('hashchange', syncActive);
    syncActive();
  }

  function viewHome(ctx){
    const examName = ctx && ctx.exam ? String(ctx.exam.title || ctx.exam.examId || '') : '';
    return `
      <div class="h1">Início</div>
      <div class="p">Você está na UI v2. Esta é a base para a experiência de novas provas (ex.: OAB).</div>

      <div class="grid">
        <div class="card">
          <div class="card-title">Prova</div>
          <div class="card-sub">Selecionada: <strong>${escapeHtml(examName || '—')}</strong></div>
          <button class="btn" type="button" id="btnChangeExam">Trocar (Hub)</button>
        </div>

        <div class="card">
          <div class="card-title">Próximo passo</div>
          <div class="card-sub">Agora que o roteamento está ok, a próxima entrega é montar o fluxo do simulado OAB (setup → execução → resultado).</div>
          <button class="btn" type="button" id="btnGoSimulado">Ir para Simulado</button>
        </div>
      </div>
    `;
  }

  function viewSimulado(ctx){
    const examId = (ctx && ctx.exam && ctx.exam.examId) ? String(ctx.exam.examId) : '';
    return `
      <div class="h1">Simulado</div>
      <div class="p">Fluxo ainda em construção. Este painel valida navegação e contexto da prova.</div>

      <div class="card">
        <div class="card-title">Contexto</div>
        <div class="card-sub">examId: <strong>${escapeHtml(examId || '—')}</strong></div>
        <div class="card-sub">Quando tivermos endpoints de questões do Marketplace para OAB, este botão inicia o simulado.</div>
        <button class="btn" type="button" id="btnStart">Começar (placeholder)</button>
      </div>
    `;
  }

  function viewConfig(ctx){
    const me = (ctx && ctx.user && ctx.user.nome) ? String(ctx.user.nome) : '';
    return `
      <div class="h1">Config</div>
      <div class="p">Preferências locais da UI v2 (por enquanto somente leitura).</div>

      <div class="grid">
        <div class="card">
          <div class="card-title">Usuário</div>
          <div class="card-sub">${escapeHtml(me || '—')}</div>
        </div>
        <div class="card">
          <div class="card-title">Sessão</div>
          <div class="card-sub">Se você cair em 401/403 aqui, volte ao Hub e refaça login.</div>
          <button class="btn" type="button" id="btnLogout2">Sair</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(s){
    const str = String(s == null ? '' : s);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderView(ctx){
    const root = qs('#viewRoot');
    if (!root) return;

    const h = String(window.location.hash || '#/');
    let html = '';

    if (h === '#/' || h === '' || h === '#') html = viewHome(ctx);
    else if (h === '#/simulado') html = viewSimulado(ctx);
    else if (h === '#/config') html = viewConfig(ctx);
    else html = `<div class="h1">Não encontrado</div><div class="p">Rota: ${escapeHtml(h)}</div>`;

    root.innerHTML = html;

    const btnChangeExam = qs('#btnChangeExam');
    if (btnChangeExam) btnChangeExam.addEventListener('click', () => window.location.assign('/home.html'));

    const btnGoSimulado = qs('#btnGoSimulado');
    if (btnGoSimulado) btnGoSimulado.addEventListener('click', () => { window.location.hash = '#/simulado'; });

    const btnLogout2 = qs('#btnLogout2');
    if (btnLogout2) btnLogout2.addEventListener('click', logout);

    const btnStart = qs('#btnStart');
    if (btnStart) btnStart.addEventListener('click', () => {
      setStatus('Em construção', 'Ainda não há endpoints de questões para a UI v2.', 'warn');
    });
  }

  async function logout(){
    try {
      if (window.Logout && typeof window.Logout.logout === 'function') {
        await window.Logout.logout({ redirectUrl: '/login' });
        return;
      }
    } catch(_){ }
    window.location.assign('/login');
  }

  async function loadBootstrapAndValidate(){
    const base = getBackendBase();
    const url = (base || '') + '/api/v1/app/bootstrap';

    setStatus('Carregando…', 'Buscando permissões e provas liberadas.');

    let resp;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow'
      });
    } catch (e) {
      setStatus('Falha de conexão', (e && e.message) ? e.message : String(e), 'err');
      return { ok: false };
    }

    if (resp.status === 401 || resp.status === 403) {
      window.location.assign('/login?redirect=' + encodeURIComponent('/home.html'));
      return { ok: false };
    }

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      setStatus('Erro no bootstrap', t || (resp.status + ' ' + resp.statusText), 'err');
      return { ok: false };
    }

    const data = await resp.json().catch(() => null);
    const exams = (data && Array.isArray(data.availableExams)) ? data.availableExams : [];

    const queryExam = getQueryExam();
    const storedExam = getSelectedExamId();
    const defaultExamId = (data && data.defaultExamId) ? String(data.defaultExamId) : null;
    const desired = queryExam || storedExam || defaultExamId || null;

    const picked = exams.find(x => x && String(x.examId) === String(desired)) || exams.find(x => x && x.uiEntry === 'v2') || exams[0] || null;

    if (!picked || !picked.examId) {
      setStatus('Nenhuma prova liberada', 'Volte ao Hub para selecionar uma prova.', 'warn');
      setExamPill(null);
      setBrandSub('UI v2');
      return { ok: false };
    }

    // If the picked exam is not v2, we should not be here.
    const uiEntry = String(picked.uiEntry || (picked.examId === 'PMP' ? 'legacy' : 'v2'));
    if (uiEntry !== 'v2') {
      window.location.assign('/');
      return { ok: false };
    }

    setSelectedExamId(picked.examId);
    setExamPill(picked.examId);
    setBrandSub(picked.title || picked.examId);

    setStatus('Pronto', 'UI v2 carregada com sucesso.');

    return { ok: true, user: data && data.user ? data.user : null, exam: picked };
  }

  function wireTopActions(){
    const b = qs('#btnLogout');
    if (b) b.addEventListener('click', logout);
  }

  async function boot(){
    wireTopActions();
    mountNav();

    if (!window.location.hash) window.location.hash = '#/';

    const ctx = await loadBootstrapAndValidate();
    renderView(ctx);

    window.addEventListener('hashchange', () => renderView(ctx));
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
