// Protótipo atualizado: simulação com texto de 280 caracteres e ajuste automático de CSS
// O script:
// - Gera uma pergunta com exatamente 280 caracteres para teste.
// - Renderiza perguntas (protótipo).
// - Ajusta automaticamente a variável CSS --question-font-size de acordo com o tamanho do texto
//   e largura do container para evitar overflow e manter legibilidade.
// - Reposiciona o timer quando o tamanho da fonte muda.

// QUESTIONS will be populated from the backend via /api/exams/select
let QUESTIONS = [];

// store user selections: key by question id (or index) -> { index, optionId }
const ANSWERS = {};

// Utility: stable shuffle (Fisher-Yates) that returns a new array
function shuffleArray(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Normalize question options to shape { id, text } and ensure a single shuffled order
function ensureShuffledOptionsForQuestion(q){
  if (!q) return q;
  // normalize options to {id, text}
  const rawOpts = Array.isArray(q.options) ? q.options : [];
  const normalized = rawOpts.map(o => {
    if (!o) return { id: null, text: '' };
    if (typeof o === 'string') return { id: null, text: o };
    return { id: (o.id || o.Id || null), text: (o.text || o.descricao || o.Descricao || o.Descricao || '') };
  });
  q.options = normalized;
  if (!Array.isArray(q.shuffledOptions) || q.shuffledOptions.length !== normalized.length) {
    q.shuffledOptions = shuffleArray(normalized);
  }
  return q;
}

function ensureShuffledOptionsForAll(questionsArray){
  try {
    if (!Array.isArray(questionsArray)) return;
    for (let i = 0; i < questionsArray.length; i++) {
      ensureShuffledOptionsForQuestion(questionsArray[i]);
    }
  } catch(e) { console.warn('ensureShuffledOptionsForAll failed', e); }
}
// restore or create a session id (use a temporary id until server returns a real one)
function genTempSessionId(){ return 'tmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
try {
  // prefer persisted server session id, else tempSessionId, else create new temp
  let sid = null;
  try { sid = localStorage.getItem('currentSessionId') || null; } catch(e){ sid = null; }
  if (!sid) {
    try { sid = localStorage.getItem('tempSessionId') || null; } catch(e){ sid = null; }
  }
  if (!sid) {
    sid = genTempSessionId();
    try { localStorage.setItem('tempSessionId', sid); } catch(e){}
  }
  // store as currentSessionId (may be temporary); will be migrated when server provides one
  try { window.currentSessionId = sid; localStorage.setItem('currentSessionId', sid); } catch(e){ window.currentSessionId = sid; }

  // rehydrate saved answers for this session if present
  try {
    const raw = localStorage.getItem(`answers_${window.currentSessionId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') Object.keys(parsed).forEach(k => { ANSWERS[k] = parsed[k]; });
    }
  } catch(e) { /* ignore malformed storage */ }
  // update autosave indicator with savedAt if present
  try {
    const sa = localStorage.getItem(`answers_${window.currentSessionId}_savedAt`);
    if (sa) updateAutosaveIndicatorSaved(sa); else updateAutosaveIndicatorHidden();
  } catch(e) { updateAutosaveIndicatorHidden(); }
} catch(e) { try{ window.currentSessionId = null; }catch(_){} }

// autosave helpers
function formatSavedAt(iso){ try { const d = new Date(iso); return d.toLocaleTimeString(); } catch(e){ return iso; } }
function updateAutosaveIndicatorSaving(){ try { const el = $('autosaveIndicator'); if (!el) return; el.style.display = ''; el.className = 'saving'; el.textContent = 'Salvando...'; } catch(e){} }
function updateAutosaveIndicatorSaved(iso){ try { const el = $('autosaveIndicator'); if (!el) return; el.style.display = ''; el.className = 'saved'; el.textContent = 'Salvo às ' + (iso ? formatSavedAt(iso) : new Date().toLocaleTimeString()); } catch(e){} }
function updateAutosaveIndicatorHidden(){ try { const el = $('autosaveIndicator'); if (!el) return; el.style.display = 'none'; el.className = ''; el.textContent = ''; } catch(e){} }

function saveAnswersForCurrentSession(){
  try {
    if (!window.currentSessionId) return;
    updateAutosaveIndicatorSaving();
    const key = `answers_${window.currentSessionId}`;
    localStorage.setItem(key, JSON.stringify(ANSWERS));
    const savedAtKey = `${key}_savedAt`;
    const now = new Date().toISOString();
    localStorage.setItem(savedAtKey, now);
    // small timeout to give a visible 'saving' state before switching to saved
  setTimeout(()=>{ updateAutosaveIndicatorSaved(now); }, 120);
    try { saveProgressForCurrentSession(); } catch(e){}
  } catch(e) { console.warn('saveAnswersForCurrentSession failed', e); }
}

// toast helper
function showToast(text, ms = 1600){
  try {
    const t = $('toast'); if (!t) return;
    t.textContent = text || '';
    t.style.display = '';
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=>{ try{ t.classList.remove('show'); setTimeout(()=>{ t.style.display = 'none'; }, 220); }catch(e){} }, ms);
  } catch(e) {}
}

// Progress persistence (current index and elapsed seconds)
function saveProgressForCurrentSession(){
  try {
    if (!window.currentSessionId) return;
    const key = `progress_${window.currentSessionId}`;
    // merge with any existing progress so we don't accidentally remove remainingSeconds
    const existingRaw = localStorage.getItem(key) || null;
    let payload = {};
    try { payload = existingRaw ? JSON.parse(existingRaw) : {}; } catch(e){ payload = {}; }
    payload.currentIdx = currentIdx;
    // preserve remainingSeconds if present; store elapsedSeconds too for compatibility
    try { payload.elapsedSeconds = timerSeconds || payload.elapsedSeconds || 0; } catch(e){ payload.elapsedSeconds = payload.elapsedSeconds || 0; }
    localStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem(`${key}_savedAt`, new Date().toISOString());
  } catch(e) { console.warn('saveProgressForCurrentSession failed', e); }
}

// when server returns a real session id, migrate answers if we used a temp id
function migrateToServerSession(newId){
  try {
    const old = window.currentSessionId;
    if (!old || old === newId) return;
    const oldKey = `answers_${old}`;
    const newKey = `answers_${newId}`;
    const raw = localStorage.getItem(oldKey);
    if (raw) {
      localStorage.setItem(newKey, raw);
      const sa = localStorage.getItem(`${oldKey}_savedAt`);
      if (sa) localStorage.setItem(`${newKey}_savedAt`, sa);
      localStorage.removeItem(oldKey);
      localStorage.removeItem(`${oldKey}_savedAt`);
    }
    // migrate progress if present
    try {
      const oldProg = `progress_${old}`;
      const newProg = `progress_${newId}`;
      const rawp = localStorage.getItem(oldProg);
      if (rawp) {
        localStorage.setItem(newProg, rawp);
        const sap = localStorage.getItem(`${oldProg}_savedAt`);
        if (sap) localStorage.setItem(`${newProg}_savedAt`, sap);
        localStorage.removeItem(oldProg);
        localStorage.removeItem(`${oldProg}_savedAt`);
      }
    } catch(e) {}
    // migrate cached questions if present so reloads keep the same set
    try {
      const oldQ = `questions_${old}`;
      const newQ = `questions_${newId}`;
      const rawq = localStorage.getItem(oldQ);
      if (rawq) {
        localStorage.setItem(newQ, rawq);
        const qsa = localStorage.getItem(`${oldQ}_savedAt`);
        if (qsa) localStorage.setItem(`${newQ}_savedAt`, qsa);
        localStorage.removeItem(oldQ);
        localStorage.removeItem(`${oldQ}_savedAt`);
      }
    } catch(e) {}
    // remove temp marker if old was temp
    if (old && old.startsWith('tmp-')) {
      try { localStorage.removeItem('tempSessionId'); } catch(e){}
    }
    window.currentSessionId = newId;
    try { localStorage.setItem('currentSessionId', newId); } catch(e){}
  } catch(e) { console.warn('migrateToServerSession failed', e); }
}

// Diagnostic: indicate the file was loaded
try {
  console.debug('[exam] script_exam.js loaded');
} catch(e) {}

// Global error handler to surface runtime errors in console (helps detect silent failures)
window.addEventListener && window.addEventListener('error', function (ev) {
  try { console.error('[exam] window error:', ev && ev.message, ev && ev.filename, ev && ev.lineno, ev && ev.error); } catch(e){}
});

let currentIdx = 0;
let timerSeconds = 0;
let timerInterval = null;

function prevQuestion(){
  if (currentIdx > 0){
    currentIdx--;
    renderQuestion(currentIdx);
    try{ saveProgressForCurrentSession(); } catch(e){}
  }
}

function $(id){ return document.getElementById(id); }

/* Gera um texto legível repetindo uma frase até atingir o comprimento desejado e então cortando. */
function generateFixedLengthText(len){
  const base = "Este é um enunciado de exemplo criado para testar a responsividade e o ajuste automático do texto na interface. ";
  let s = '';
  while (s.length < len){
    s += base;
  }
  s = s.slice(0, len);
  // garantir que não termine com um espaço indesejado
  return s.trim();
}

function startTimer(){
  let tickCounter = 0;
  timerInterval = setInterval(()=>{
    timerSeconds++;
    $('timerDisplay').textContent = formatTime(timerSeconds);
    tickCounter++;
    // save progress every 5 seconds
    if (tickCounter >= 5){ tickCounter = 0; try{ saveProgressForCurrentSession(); } catch(e){} }
  }, 1000);
}
function formatTime(totalSeconds){
  const mm = String(Math.floor(totalSeconds/60)).padStart(2,'0');
  const ss = String(totalSeconds % 60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function renderQuestion(idx){
  const q = QUESTIONS[idx];
  if (!q) {
    // no question available - show placeholder
    $('questionNumber').textContent = 0;
    $('totalQuestions').textContent = 0;
    $('questionText').textContent = 'Nenhuma pergunta disponível.';
    for(let i=0;i<4;i++){
      $(`opt${i}`).textContent = '';
      const radio = document.querySelector(`#answersForm input[name="answer"][value="${i}"]`);
      if (radio) radio.checked = false;
    }
    return;
  }
  // manter "Exemplo" fixo no header conforme solicitado; apenas atualizamos número e texto
  $('questionNumber').textContent = idx + 1;
  $('totalQuestions').textContent = QUESTIONS.length;
  $('questionText').textContent = q.text || q.descricao || '';

  // use precomputed shuffledOptions (frozen order for the session)
  const optObjs = Array.isArray(q.shuffledOptions) ? q.shuffledOptions.slice() : (Array.isArray(q.options) ? q.options.slice() : []);
  // determine storage key for this question
  const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${idx}`;

  // try to restore by optionId (robust against option shuffling); fall back to saved index
  const prev = ANSWERS[qKey];
  let restoredIndex = null;
  try {
    if (prev && prev.optionId !== undefined && prev.optionId !== null && String(prev.optionId) !== '') {
      const found = optObjs.findIndex(o => String(o.id) === String(prev.optionId));
      if (found >= 0) restoredIndex = found;
    }
  } catch(e) {}
  // fallback to numeric index if we didn't find by optionId
  if (restoredIndex === null && prev && typeof prev.index === 'number') restoredIndex = prev.index;

  for(let i=0;i<4;i++){
    const opt = optObjs[i] || { id: null, text: `Opção ${i+1}` };
    $(`opt${i}`).textContent = opt.text;
    const radio = document.querySelector(`#answersForm input[name="answer"][value="${i}"]`);
    if (radio) {
      // attach option id to radio for submission
      try { radio.dataset.optionId = opt.id === undefined || opt.id === null ? '' : String(opt.id); } catch(e){}

      // restore previous checked state: prefer restoredIndex (from optionId), else false
      radio.checked = (restoredIndex === i);

      // save selection on change and enable Continue button (also persist to localStorage)
      radio.onchange = function(){
        try {
          const chosenId = this.dataset && this.dataset.optionId ? this.dataset.optionId : '';
          ANSWERS[qKey] = { index: i, optionId: chosenId };
          const contBtn = $('continueBtn'); if (contBtn) contBtn.disabled = false;
          // persist incremental answers for this session (auto-save helper)
          try { saveAnswersForCurrentSession(); } catch(e){}
          // remove any visual error indicator
          try { const qc = $('questionContent'); if (qc) qc.classList.remove('input-error'); } catch(e){}
        } catch(e) { /* ignore */ }
      };
    }
  }

  // if we restored by optionId, ensure in-memory ANSWERS reflects the (possibly new) index
  try {
    if (restoredIndex !== null) {
      const chosen = optObjs[restoredIndex] || { id: null };
      ANSWERS[qKey] = { index: restoredIndex, optionId: chosen.id === undefined || chosen.id === null ? '' : String(chosen.id) };
      // ensure Continue button enabled when an answer exists
      const contBtn = $('continueBtn'); if (contBtn) contBtn.disabled = false;
    }
  } catch(e) {}
  $('likeBtn').setAttribute('aria-pressed','false');
  $('dislikeBtn').setAttribute('aria-pressed','false');

  // show or hide back button depending on position
  try {
    const back = $('backBtn');
    if (back) {
      if (idx > 0) { back.style.display = ''; } else { back.style.display = 'none'; }
    }
  } catch(e) {}

  // enable/disable Continue button depending on whether an answer exists
  try {
    const contBtn = $('continueBtn');
    if (contBtn) {
      const has = ANSWERS[qKey] && ANSWERS[qKey].optionId;
      contBtn.disabled = !has;
    }
  } catch(e) {}

  // ajustar tipografia automaticamente com base no comprimento do texto e largura disponível
  adaptQuestionTypography();
}

function nextQuestion(){
  // require an option to be selected before proceeding
  const q = QUESTIONS[currentIdx];
  const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${currentIdx}`;
  const selInfo = ANSWERS[qKey];
  if (!selInfo || !selInfo.optionId) {
    // visual cue: shake + red border
    try {
      const qc = $('questionContent');
      if (qc) {
        qc.classList.remove('input-error');
        // trigger reflow to restart animation
        void qc.offsetWidth;
        qc.classList.add('input-error');
        setTimeout(()=>{ try{ qc.classList.remove('input-error'); }catch(e){} }, 700);
      }
    } catch(e){}
    return;
  }
  if (currentIdx < QUESTIONS.length - 1){
    currentIdx++;
    renderQuestion(currentIdx);
    try{ saveProgressForCurrentSession(); } catch(e){}
  } else {
    // end of exam: collect answers and submit to backend
    clearInterval(timerInterval);
    submitExam().catch(err=>{
      try { console.error('submitExam error', err); alert('Erro ao enviar respostas.'); } catch(e){}
    });
  }
}

async function submitExam(){
  try {
    const answers = [];
    for (let i = 0; i < QUESTIONS.length; i++){
      const q = QUESTIONS[i];
      const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${i}`;
      const a = ANSWERS[qKey];
      const questionId = q && q.id ? Number(q.id) : null;
      const optionId = a && a.optionId ? Number(a.optionId) : null;
      answers.push({ questionId, optionId });
    }

    const payload = { sessionId: window.currentSessionId || null, answers };
    const token = localStorage.getItem('sessionToken') || '';
    const submitUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE || '') + '/api/exams/submit';
    const resp = await fetch(submitUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': token }, body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('submit failed: ' + resp.status);
    const data = await resp.json();

    // show results in #status area
    try {
      const status = $('status');
      if (status) {
        status.style.display = '';
        status.textContent = `Resultado: ${data.totalCorrect} / ${data.totalQuestions} questões corretas.`;
      } else {
        alert(`Resultado: ${data.totalCorrect} / ${data.totalQuestions}`);
      }
    } catch(e){ console.warn('show result failed', e); }

    // disable controls to prevent re-submission
    try {
      const contBtn = $('continueBtn'); if (contBtn) contBtn.disabled = true;
      const backBtn = $('backBtn'); if (backBtn) backBtn.disabled = true;
    } catch(e){}

    // clear persisted session id and saved answers now that exam was submitted
    try { 
      const old = window.currentSessionId;
      localStorage.removeItem('currentSessionId');
      try { localStorage.removeItem('tempSessionId'); } catch(e){}
      if (old) localStorage.removeItem(`answers_${old}`);
  if (old) localStorage.removeItem(`answers_${old}_savedAt`);
  // remove persisted progress as well
  try { if (old) localStorage.removeItem(`progress_${old}`); if (old) localStorage.removeItem(`progress_${old}_savedAt`); } catch(e){}
  // remove cached questions for this session
  try { if (old) localStorage.removeItem(`questions_${old}`); if (old) localStorage.removeItem(`questions_${old}_savedAt`); } catch(e){}
      window.currentSessionId = null;
      // hide autosave indicator
      try { updateAutosaveIndicatorHidden(); } catch(e){}
    } catch(e){}

    return data;
  } catch (err) {
    console.error('submitExam error', err);
    throw err;
  }
}

/* Feedback like/dislike toggles */
function initFeedback(){
  const like = $('likeBtn');
  const dislike = $('dislikeBtn');

  like.addEventListener('click', ()=>{
    const cur = like.getAttribute('aria-pressed') === 'true';
    like.setAttribute('aria-pressed', String(!cur));
    if (!cur) dislike.setAttribute('aria-pressed','false');
  });

  dislike.addEventListener('click', ()=>{
    const cur = dislike.getAttribute('aria-pressed') === 'true';
    dislike.setAttribute('aria-pressed', String(!cur));
    if (!cur) $('likeBtn').setAttribute('aria-pressed','false');
  });
}

/* Controle de fonte (slider) */
function initFontControl(){
  const fontRange = $('fontRange');
  const fontToggle = $('fontToggle');
  const fontSlider = $('fontSlider');

  fontRange.addEventListener('input', (e)=>{
    const v = e.target.value + 'px';
    document.documentElement.style.setProperty('--base-font-size', v);
    // reposicionar e readaptar tipografia
    requestAnimationFrame(()=>{ adaptQuestionTypography(); positionTimer(); });
  });

  fontToggle.addEventListener('click', ()=>{
    const isHidden = fontSlider.hasAttribute('hidden');
    if (isHidden){
      fontSlider.removeAttribute('hidden');
      fontToggle.setAttribute('aria-expanded','true');
    } else {
      fontSlider.setAttribute('hidden','');
      fontToggle.setAttribute('aria-expanded','false');
    }
  });

  document.addEventListener('click', (ev)=>{
    if (!fontToggle.contains(ev.target) && !fontSlider.contains(ev.target)){
      fontSlider.setAttribute('hidden','');
      fontToggle.setAttribute('aria-expanded','false');
    }
  });
}

/* Ajuste automático da tipografia do texto da pergunta.
   Estratégia:
   - Usa o comprimento do texto (caracteres) e a largura do container para escolher um tamanho
     de fonte (variável CSS --question-font-size).
   - Garante um mínimo e máximo e faz pequenos passos para preservar legibilidade.
*/
function adaptQuestionTypography(){
  const p = $('questionText');
  const container = p.parentElement; // .question-content
  if (!p || !container) return;

  const text = p.textContent || '';
  const chars = text.length;
  const containerWidth = container.getBoundingClientRect().width;

  // parâmetros base
  const maxFont = 18; // px
  const minFont = 13; // px

  // heurística simples:
  // quanto mais caracteres e quanto menor o container, menor a fonte
  // basear no produto chars / containerWidth para decidir
  const density = chars / containerWidth; // chars per px

  // map density to font size (linear mapping within sensible range)
  // density 0.4 -> maxFont ; density 1.2 -> minFont (empírico)
  const dMin = 0.35;
  const dMax = 1.2;
  let ratio = (density - dMin) / (dMax - dMin);
  ratio = Math.max(0, Math.min(1, ratio));
  const fontSize = Math.round(maxFont - (maxFont - minFont) * ratio);

  // aplicar
  document.documentElement.style.setProperty('--question-font-size', `${fontSize}px`);

  // também ajustar line-height proporcionalmente
  const lineH = Math.max(1.35, Math.min(1.7, 1.2 + (fontSize - minFont) / (maxFont - minFont) * 0.4));
  document.documentElement.style.setProperty('--question-line-height', lineH);

  // reposicionar timer pois largura do texto pode ter mudado
  positionTimer();
}

/* Posicionamento leve do timer dentro do header-center */
function positionTimer(){
  const center = $('centerHeader');
  const knowledge = $('knowledgeArea');
  const timer = $('timerBox');

  if (!center || !knowledge || !timer) return;

  // Em telas pequenas confiamos no CSS
  if (window.innerWidth <= 600){
    timer.style.position = '';
    timer.style.left = '';
    timer.style.top = '';
    timer.style.transform = '';
    return;
  }

  const centerRect = center.getBoundingClientRect();
  const knowledgeRect = knowledge.getBoundingClientRect();

  const gap = 10;
  const textRightRelative = knowledgeRect.right - centerRect.left;
  const desiredLeft = textRightRelative + gap;

  timer.style.position = 'absolute';
  timer.style.left = `${desiredLeft}px`;
  timer.style.top = '50%';
  timer.style.transform = 'translateY(-50%)';
}

/* Inicialização */
function initExam(){
  renderQuestion(currentIdx);
  // Prefer the global countdown (defined in exam.html) which runs a decrementing timer.
  // If not available, fall back to the incremental startTimer (legacy/compat).
  try {
    if (typeof window.startExamCountdown === 'function') {
      window.startExamCountdown();
    } else {
      startTimer();
    }
  } catch(e) { try { startTimer(); } catch(_) {} }
  initFontControl();
  initFeedback();

  const cont = $('continueBtn');
  if (cont) cont.addEventListener('click', nextQuestion);
  const back = $('backBtn');
  if (back) back.addEventListener('click', prevQuestion);
  document.querySelector('#answersForm').addEventListener('submit', (e)=> e.preventDefault());

  // posicionar o timer inicialmente e ao redimensionar (debounced)
  positionTimer();
  adaptQuestionTypography();
  let resizeTO;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=>{
      adaptQuestionTypography();
      positionTimer();
    }, 120);
  });

  // reposicionar/adaptar após fontes e recursos serem carregados
  setTimeout(()=>{ adaptQuestionTypography(); positionTimer(); }, 300);
}

document.addEventListener('DOMContentLoaded', ()=>{
  // load questions from backend then initialize exam
  async function prepareAndInit(){
    try {
      console.debug('[exam] prepareAndInit start');
      // attempt to fetch questions from backend
      const count = Number(window.QtdQuestoes) || (localStorage.getItem('examQuestionCount') ? Number(localStorage.getItem('examQuestionCount')) : 0);
      console.debug('[exam] QtdQuestoes=', window.QtdQuestoes, 'localStorage.examQuestionCount=', localStorage.getItem('examQuestionCount'));
      if (!count) {
        // fallback to sample questions
        QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
        // normalize and freeze option order once
        try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
        initExam();
        return;
      }

      const token = localStorage.getItem('sessionToken') || '';
      // If we have cached questions for this session, use them and skip network fetch
      try {
        if (window.currentSessionId) {
          const qraw = localStorage.getItem(`questions_${window.currentSessionId}`);
          if (qraw) {
            try { QUESTIONS = JSON.parse(qraw); } catch(e) { QUESTIONS = []; }
            // ensure options are normalized and frozen (in case older cache lacked shuffledOptions)
            try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
            // rehydrate answers and progress for this cached set
            try {
              const raw = localStorage.getItem(`answers_${window.currentSessionId}`);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') Object.keys(parsed).forEach(k => { ANSWERS[k] = parsed[k]; });
              }
            } catch(e) {}
            try {
              const progRaw = localStorage.getItem(`progress_${window.currentSessionId}`) || null;
              if (progRaw) {
                const prog = JSON.parse(progRaw);
                if (prog && typeof prog === 'object') {
                  if (typeof prog.currentIdx === 'number' && prog.currentIdx >= 0 && prog.currentIdx < QUESTIONS.length) currentIdx = prog.currentIdx;
                  if (typeof prog.elapsedSeconds === 'number') { timerSeconds = prog.elapsedSeconds; try { const disp = $('timerDisplay'); if (disp) disp.textContent = formatTime(timerSeconds); } catch(e){} }
                }
              }
            } catch(e) {}
            // ensure there's at least an answers object persisted for this session
            try { if (window.currentSessionId && !localStorage.getItem(`answers_${window.currentSessionId}`)) saveAnswersForCurrentSession(); } catch(e){}
            initExam();
            return;
          }
        }
      } catch(e) {}
      console.debug('[exam] using sessionToken=', token);
      const fetchUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE || '') + '/api/exams/select';
      console.debug('[exam] fetching questions from', fetchUrl, 'count=', count);
      const resp = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
        body: JSON.stringify({ count })
      });
      if (!resp.ok) {
        console.warn('Failed to fetch questions', resp.status);
        // fallback to sample questions so the UI remains usable
        QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
        initExam();
        return;
      }
      const data = await resp.json();
      console.debug('[exam] fetched data', data && { total: data.total, questions: (data.questions||[]).length });
      if (data && Array.isArray(data.questions) && data.questions.length) {
        // persist / migrate session id: if server returned a real session id, migrate answers from temp
        try {
          if (data.sessionId) {
            const prev = window.currentSessionId;
            migrateToServerSession(data.sessionId);
            // if there is a savedAt for the new session, show it
            try {
              const sa = localStorage.getItem(`answers_${data.sessionId}_savedAt`);
              if (sa) updateAutosaveIndicatorSaved(sa);
              else updateAutosaveIndicatorHidden();
            } catch(e) { updateAutosaveIndicatorHidden(); }
          }
        } catch(e){}
        // attempt to rehydrate saved answers for this session (if any)
        try {
          if (window.currentSessionId) {
            const raw = localStorage.getItem(`answers_${window.currentSessionId}`);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                Object.keys(parsed).forEach(k => { ANSWERS[k] = parsed[k]; });
              }
            }
          }
        } catch(e) { /* ignore */ }
        QUESTIONS = data.questions.map(q => ({
          id: q.id,
          descricao: q.descricao,
          explicacao: q.explicacao,
          idprocesso: q.idprocesso,
          text: q.descricao,
          options: (q.options || []).map(o => ({ id: o.id || o.Id || null, text: (o.text || o.descricao || o.Descricao || '') }))
        }));
        // ensure each question has a single shuffledOptions array (frozen order)
        try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
        // persist the questions for this session so reloads don't change them
        try {
          if (window.currentSessionId) {
            const qkey = `questions_${window.currentSessionId}`;
            if (!localStorage.getItem(qkey)) {
              localStorage.setItem(qkey, JSON.stringify(QUESTIONS));
              localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
            }
          }
        } catch(e) {}
        // rehydrate progress (current index and elapsedSeconds) if present for this session
        try {
          if (window.currentSessionId) {
            const progRaw = localStorage.getItem(`progress_${window.currentSessionId}`) || null;
            if (progRaw) {
              const prog = JSON.parse(progRaw);
                      if (prog && typeof prog === 'object') {
                        if (typeof prog.currentIdx === 'number' && prog.currentIdx >= 0 && prog.currentIdx < QUESTIONS.length) {
                          currentIdx = prog.currentIdx;
                        }
                        // prefer remainingSeconds for countdown resume; fall back to elapsedSeconds for compatibility
                        if (prog.remainingSeconds !== undefined && prog.remainingSeconds !== null) {
                          try { const disp = $('timerDisplay'); if (disp) disp.textContent = formatTime(Number(prog.remainingSeconds)); } catch(e){}
                        } else if (typeof prog.elapsedSeconds === 'number') {
                          try { const disp = $('timerDisplay'); if (disp) disp.textContent = formatTime(prog.elapsedSeconds); } catch(e){}
                        }
                      }
            }
          }
        } catch(e) {}
  // ensure there's at least an answers object persisted for this session (and record savedAt)
  try { if (window.currentSessionId && !localStorage.getItem(`answers_${window.currentSessionId}`)) saveAnswersForCurrentSession(); } catch(e){}
      } else {
        // no questions returned - fallback
        QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
      }
    } catch (e) {
      console.warn('prepareAndInit error', e);
    }
    initExam();
  }

  // If guest token and we don't have any user info, wait for registration then prepare.
  // If we already have userId/nomeUsuario/nome, proceed even if sessionToken ends with '#'.
  const session = localStorage.getItem('sessionToken') || '';
  const hasUserId = !!localStorage.getItem('userId');
  const hasNomeUsuario = !!localStorage.getItem('nomeUsuario');
  const hasNome = !!localStorage.getItem('nome');
  const isGuest = session.endsWith('#');

  if (isGuest && !(hasUserId || hasNomeUsuario || hasNome)){
    const poll = setInterval(()=>{
      const s = localStorage.getItem('sessionToken') || '';
      const hId = !!localStorage.getItem('userId');
      const hNomeU = !!localStorage.getItem('nomeUsuario');
      const hNome = !!localStorage.getItem('nome');
      if (!s.endsWith('#') || hId || hNomeU || hNome){
        clearInterval(poll);
        prepareAndInit();
      }
    }, 300);
    window.addEventListener('storage', (ev)=>{
      if (ev.key === 'sessionToken' && ev.newValue && !ev.newValue.endsWith('#')){
        clearInterval(poll);
        prepareAndInit();
      }
      if ((ev.key === 'userId' || ev.key === 'nomeUsuario' || ev.key === 'nome') && ev.newValue){
        clearInterval(poll);
        prepareAndInit();
      }
    });
  } else {
    prepareAndInit();
  }
});
