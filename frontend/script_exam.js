// Protótipo atualizado: simulação com texto de 280 caracteres e ajuste automático de CSS
  // load questions from backend then initialize exam
            // QUESTIONS will be populated from the backend via /api/exams/select
            let QUESTIONS = [];

            // store user selections: key by question id (or index) -> { index, optionId } or { indices:[], optionIds:[] }
            const ANSWERS = {};

            // Current exam blueprint (durations, checkpoints, multi-select, etc.)
            let EXAM_BP = (function(){
              try {
                const raw = localStorage.getItem('examBlueprint');
                if (!raw) return null;
                const bp = JSON.parse(raw);
                return (bp && typeof bp === 'object') ? bp : null;
              } catch(e){ return null; }
            })();

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

            // toast helper (now supports centered positioning)
            // Usage:
            //  - showToast('Mensagem')
            //  - showToast('Mensagem', 2000)
            //  - showToast('Mensagem', 2000, true) // center
            //  - showToast('Mensagem', 2000, { center: true })
            //  - showToast('Mensagem', 2000, { position: 'center' })
            function showToast(text, ms = 1600, opts){
              try {
                const t = $('toast'); if (!t) return;
                const center = (typeof opts === 'boolean') ? opts : !!(opts && (opts.center || opts.position === 'center'));
                if (center) t.classList.add('toast-center');
                t.textContent = text || '';
                t.style.display = '';
                requestAnimationFrame(()=> t.classList.add('show'));
                setTimeout(()=>{
                  try{
                    t.classList.remove('show');
                    setTimeout(()=>{
                      try {
                        t.style.display = 'none';
                        // remove centering class after hide to restore default position for future toasts
                        if (center) t.classList.remove('toast-center');
                      } catch(e){}
                    }, 220);
                  }catch(e){}
                }, ms);
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

            // Back-navigation barrier helpers (persist per session)
            function getBackBarrier(){
              try {
                const sid = window.currentSessionId || null;
                if (!sid) return 0;
                const raw = localStorage.getItem(`backBarrier_${sid}`);
                const n = raw ? Number(raw) : 0;
                return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
              } catch(e){ return 0; }
            }
            function setBackBarrier(n){
              try {
                const sid = window.currentSessionId || null;
                if (!sid) return;
                const current = getBackBarrier();
                if (n !== current) localStorage.setItem(`backBarrier_${sid}`, String(n));
              } catch(e){}
            }

            // Continue override at checkpoints (persist per session)
            function isContinueOverrideEnabled(){
              try {
                const sid = window.currentSessionId || null;
                if (!sid) return false;
                return localStorage.getItem(`allowContinueAfterCheckpoint_${sid}`) === 'true';
              } catch(e){ return false; }
            }
            function setContinueOverrideEnabled(v){
              try {
                const sid = window.currentSessionId || null;
                if (!sid) return;
                localStorage.setItem(`allowContinueAfterCheckpoint_${sid}`, v ? 'true' : 'false');
              } catch(e){}
            }

            // Pause guard helpers
            function isPauseActive(){
              try {
                const sid = window.currentSessionId || null; if (!sid) return false;
                const raw = localStorage.getItem(`pauseUntil_${sid}`); if (!raw) return false;
                const until = Number(raw); if (!Number.isFinite(until)) return false;
                return until > Date.now();
              } catch(e){ return false; }
            }

            function prevQuestion(){
              const barrier = getBackBarrier();
              if (currentIdx > barrier){
                currentIdx = Math.max(barrier, currentIdx - 1);
                renderQuestion(currentIdx);
                try{ saveProgressForCurrentSession(); } catch(e){}
              }
            }

            function $(id){ return document.getElementById(id); }

            // --- Destaque de questão (persistido por sessão) ---
            function highlightStoreKey(){ try { return window.currentSessionId ? `highlights_${window.currentSessionId}` : null; } catch(e){ return null; } }
            function readHighlights(){
              try { const k = highlightStoreKey(); if (!k) return {}; const raw = localStorage.getItem(k); if (!raw) return {}; const obj = JSON.parse(raw); return (obj && typeof obj === 'object') ? obj : {}; } catch(e){ return {}; }
            }
            function writeHighlights(map){ try { const k = highlightStoreKey(); if (!k) return; localStorage.setItem(k, JSON.stringify(map || {})); } catch(e){} }
            function isHighlighted(qKey){ try { const map = readHighlights(); return !!map[qKey]; } catch(e){ return false; } }
            function setHighlighted(qKey, val){ try { const map = readHighlights(); if (val) { map[qKey] = true; } else { delete map[qKey]; } writeHighlights(map); } catch(e){} }
            function questionKeyFor(idx){
              try { const q = QUESTIONS[idx]; if (!q) return `idx_${idx}`; return (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${idx}`; } catch(e){ return `idx_${idx}`; }
            }
            function applyHighlightUI(qKey){
              try {
                const p = $('questionText');
                const btn = $('bhighlight');
                const on = isHighlighted(qKey);
                if (p) {
                  if (on) p.classList.add('highlighted'); else p.classList.remove('highlighted');
                }
                if (btn) {
                  btn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 3.2L3.2 14 2 22l8-1.2L22.8 10 14 3.2z"></path><path d="M2 22h10v2H2z"></path></svg> ' + (on ? 'Remover destaque' : 'Destacar questão');
                }
              } catch(e){}
            }

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
                  try { const ac = document.getElementById('answersContainer'); if (ac) ac.innerHTML = ''; } catch(e){}
                return;
              }
              // manter "Exemplo" fixo no header conforme solicitado; apenas atualizamos número e texto
              $('questionNumber').textContent = idx + 1;
              $('totalQuestions').textContent = QUESTIONS.length;
              $('questionText').textContent = q.text || q.descricao || '';

              // Restaurar estado de destaque (vermelho) e rótulo do botão
              try { const qKeyHL = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${idx}`; applyHighlightUI(qKeyHL); } catch(e){}

              // Update back-navigation barrier when crossing checkpoints (from blueprint checkpoints)
              try {
                const existing = getBackBarrier();
                const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                let newBarrier = existing;
                cps.forEach(cp => { if (idx >= cp && cp > newBarrier) newBarrier = cp; });
                if (newBarrier !== existing) setBackBarrier(newBarrier);
              } catch(e){}

              // use precomputed shuffledOptions (frozen order for the session)
              const optObjs = Array.isArray(q.shuffledOptions) ? q.shuffledOptions.slice() : (Array.isArray(q.options) ? q.options.slice() : []);
              // determine storage key for this question
              const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${idx}`;

                // Render dynamic options
                const ac = document.getElementById('answersContainer');
                if (ac) {
                  ac.innerHTML = '';
                  // Decide multi-select per question: prefer question.type, then fallback to exam blueprint
                  const isMulti = (function(){
                    try {
                      if (q && typeof q.type === 'string') {
                        const t = q.type.toLowerCase();
                        if (t === 'checkbox' || t === 'multi' || t === 'multiple') return true;
                        if (t === 'radio' || t === 'single') return false;
                      }
                    } catch(e){}
                    return !!(EXAM_BP && EXAM_BP.multiplaSelecao);
                  })();
                  const inputType = isMulti ? 'checkbox' : 'radio';
                  const name = isMulti ? `answers_${qKey}` : 'answer';

                  // UI hint for multi-select exams
                  if (isMulti) {
                    try {
                      const hint = document.createElement('div');
                      hint.className = 'multi-select-hint';
                      hint.setAttribute('role', 'note');
                      hint.style.cssText = 'margin-bottom:8px;color:#555;font-size:0.95rem;';
                      hint.textContent = 'Selecione todas as alternativas corretas.';
                      ac.appendChild(hint);
                    } catch(e){}
                  }

                  // try to restore previous selection(s)
                  const prev = ANSWERS[qKey];
                  let restoredIndex = null;
                  let restoredIndices = [];
                    if (isMulti) {
                    try {
                      if (prev && Array.isArray(prev.optionIds)) {
                        const set = new Set(prev.optionIds.map(v => String(v)));
                        restoredIndices = optObjs.reduce((arr, o, i) => { if (set.has(String(o.id))) arr.push(i); return arr; }, []);
                      }
                    } catch(e){}
                  } else {
                    try {
                      if (prev && prev.optionId !== undefined && prev.optionId !== null && String(prev.optionId) !== '') {
                        const found = optObjs.findIndex(o => String(o.id) === String(prev.optionId));
                        if (found >= 0) restoredIndex = found;
                      }
                    } catch(e){}
                    if (restoredIndex === null && prev && typeof prev.index === 'number') restoredIndex = prev.index;
                  }

                  optObjs.forEach((opt, i) => {
                    const wrap = document.createElement('div');
                    wrap.className = 'option';
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = inputType;
                    input.name = name;
                    input.value = String(i);
                    input.dataset.optionId = (opt.id === undefined || opt.id === null) ? '' : String(opt.id);
                    if (isMulti) input.checked = restoredIndices.includes(i); else input.checked = (restoredIndex === i);
                    const span = document.createElement('span');
                    span.className = 'option-text';
                    span.textContent = opt.text || `Opção ${i+1}`;
                    label.appendChild(input);
                    label.appendChild(span);
                    wrap.appendChild(label);
                    ac.appendChild(wrap);

                    input.addEventListener('change', function(){
                      try {
                        const contBtn = $('continueBtn');
                        if (isMulti) {
                          const checks = Array.from(ac.querySelectorAll('input[type="checkbox"]'));
                          const selIdx = [];
                          const selIds = [];
                          checks.forEach((cb, idx) => {
                            if (cb.checked) {
                              selIdx.push(idx);
                              const oid = cb.dataset && cb.dataset.optionId ? cb.dataset.optionId : '';
                              if (oid !== '') selIds.push(oid);
                            }
                          });
                          ANSWERS[qKey] = { indices: selIdx, optionIds: selIds };
                          if (contBtn) {
                            const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                            const atExtraGate = (typeof currentIdx === 'number' && (currentIdx === 59 || currentIdx === 119));
                            const isCheckpoint = cps.includes(currentIdx);
                            const allowOverride = isContinueOverrideEnabled();
                            const inPause = isPauseActive();
                            const gate = (isCheckpoint || atExtraGate) && !allowOverride;
                            contBtn.disabled = inPause || gate || selIdx.length === 0;
                          }
                        } else {
                          const chosenId = this.dataset && this.dataset.optionId ? this.dataset.optionId : '';
                          ANSWERS[qKey] = { index: i, optionId: chosenId };
                          if (contBtn) {
                            const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                            const atExtraGate = (typeof currentIdx === 'number' && (currentIdx === 59 || currentIdx === 119));
                            const isCheckpoint = cps.includes(currentIdx);
                            const allowOverride = isContinueOverrideEnabled();
                            const inPause = isPauseActive();
                            const gate = (isCheckpoint || atExtraGate) && !allowOverride;
                            contBtn.disabled = inPause || gate;
                          }
                        }
                        try { saveAnswersForCurrentSession(); } catch(e){}
                        try { const qc = $('questionContent'); if (qc) qc.classList.remove('input-error'); } catch(e){}
                      } catch(e){}
                    });
                  });

                  // set initial state of Continue button based on restored selection
                  try {
                    const contBtn = $('continueBtn');
                    if (contBtn) {
                      if (isMulti) {
                        contBtn.disabled = isPauseActive() || !(Array.isArray(restoredIndices) && restoredIndices.length > 0);
                      } else {
                        contBtn.disabled = isPauseActive() || !(restoredIndex !== null);
                      }
                    }
                  } catch(e){}
                }

              
              try { const lb = $('likeBtn'); if (lb) lb.setAttribute('aria-pressed','false'); } catch(e){}
              try { const db = $('dislikeBtn'); if (db) db.setAttribute('aria-pressed','false'); } catch(e){}

              // show or hide back button depending on position
              try {
                const back = $('backBtn');
                if (back) {
                  const barrier = getBackBarrier();
                  if (idx > barrier) { back.style.display = ''; } else { back.style.display = 'none'; }
                }
              } catch(e) {}

              // enable/disable Continue button depending on checkpoint/pause
              try {
                const contBtn = $('continueBtn');
                if (contBtn) {
                  const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                  const isCheckpoint = cps.includes(idx);
                  const allowOverride = isContinueOverrideEnabled();
                  const inPause = isPauseActive();
                  // Bloquear durante a pausa; senão, seguir regra de checkpoint
                  // Requisito adicional: ao chegar nos índices 59 e 119 (questões 60 e 120, 1-based),
                  // desabilitar também como se fossem checkpoints, a menos que haja override.
                  const isExtraGate = (idx === 59 || idx === 119);
                  contBtn.disabled = inPause || ((isCheckpoint || isExtraGate) && !allowOverride);
                }
              } catch(e) {}

              // ajustar tipografia automaticamente com base no comprimento do texto e largura disponível
              adaptQuestionTypography();

              // Emit index change event for external UI (e.g., grid/break button)
              try {
                const barrier = getBackBarrier();
                const ev = new CustomEvent('exam:question-index-changed', { detail: { index: idx, barrier } });
                document.dispatchEvent(ev);
                // Notificar checkpoints de pré-pausa
                try {
                  const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                  if (cps.includes(idx)){
                    const ev2 = new CustomEvent('exam:pre-pause-reached', { detail: { index: idx, barrier } });
                    document.dispatchEvent(ev2);
                  }
                } catch(e){}
              } catch(e){}
            }

            function nextQuestion(){
              // Guardar contra avanço durante pausa ativa, independente do estado visual do botão
              if (isPauseActive()){
                try { showToast('Pausa em andamento. Aguarde o término.'); } catch(e){}
                return;
              }
              // Guardar contra avanço em checkpoints (e nos índices 59/119 que representam as questões 60/120 1-based)
              try {
                const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                const isCheckpoint = cps.includes(currentIdx);
                const atExtraGate = (currentIdx === 59 || currentIdx === 119);
                const allowOverride = isContinueOverrideEnabled();
                if ((isCheckpoint || atExtraGate) && !allowOverride){
                  try { showToast('Revise neste ponto. Use os botões no topo para continuar ou fazer a pausa.'); } catch(_){}
                  return;
                }
              } catch(_){}
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
                  const isMulti = (function(){
                    try { if (q && typeof q.type === 'string') { const t = q.type.toLowerCase(); return (t === 'checkbox' || t === 'multi' || t === 'multiple'); } } catch(e){}
                    return !!(EXAM_BP && EXAM_BP.multiplaSelecao);
                  })();
                  if (isMulti) {
                    const optionIds = Array.isArray(a && a.optionIds) ? a.optionIds.map(Number).filter(n => Number.isFinite(n)) : [];
                    answers.push({ questionId, optionIds });
                  } else {
                    const optionId = a && a.optionId ? Number(a.optionId) : null;
                    answers.push({ questionId, optionId });
                  }
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
                  // remove FirstStop/SecondStop flags for this session
                  try { if (old) { localStorage.removeItem(`FirstStop_${old}`); localStorage.removeItem(`SecondStop_${old}`); } } catch(e){}
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

            async function submitPartial(){
              try {
                const answers = [];
                for (let i = 0; i < QUESTIONS.length; i++){
                  const q = QUESTIONS[i];
                  const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${i}`;
                  const a = ANSWERS[qKey];
                  const questionId = q && q.id ? Number(q.id) : null;
                  const isMulti = (function(){
                    try { if (q && typeof q.type === 'string') { const t = q.type.toLowerCase(); return (t === 'checkbox' || t === 'multi' || t === 'multiple'); } } catch(e){}
                    return !!(EXAM_BP && EXAM_BP.multiplaSelecao);
                  })();
                  if (isMulti) {
                    const optionIds = Array.isArray(a && a.optionIds) ? a.optionIds.map(Number).filter(n => Number.isFinite(n)) : [];
                    if (questionId && optionIds.length) answers.push({ questionId, optionIds });
                  } else {
                    const optionId = (a && a.optionId != null && a.optionId !== '') ? Number(a.optionId) : null;
                    if (questionId && Number.isFinite(optionId)) answers.push({ questionId, optionId });
                  }
                }
                if (!answers.length) return { ok: true, saved: 0 };
                const payload = { sessionId: window.currentSessionId || null, answers, partial: true };
                const token = localStorage.getItem('sessionToken') || '';
                const submitUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE || '') + '/api/exams/submit';
                const resp = await fetch(submitUrl, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': token }, body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error('partial submit failed: ' + resp.status);
                const data = await resp.json();
                return data;
              } catch (e) {
                console.warn('submitPartial error', e);
                return { ok: false, error: String(e && e.message || e) };
              }
            }

            // expose submitExam globally so pages can trigger submission on finalize
            try { window.submitExam = submitExam; } catch(e) {}

            /* Feedback like/dislike toggles */
            function initFeedback(){
              try {
                const like = $('likeBtn');
                const dislike = $('dislikeBtn');
                if (!like || !dislike) return; // safely skip if feedback UI not present

                like.addEventListener('click', ()=>{
                  const cur = like.getAttribute('aria-pressed') === 'true';
                  like.setAttribute('aria-pressed', String(!cur));
                  if (!cur && dislike) dislike.setAttribute('aria-pressed','false');
                });

                dislike.addEventListener('click', ()=>{
                  const cur = dislike.getAttribute('aria-pressed') === 'true';
                  dislike.setAttribute('aria-pressed', String(!cur));
                  if (!cur && like) like.setAttribute('aria-pressed','false');
                });
              } catch(e){}
            }

            // Auto-submit partial answers at checkpoints (e.g., indices 60 and 120)
            try {
              document.addEventListener('exam:pre-pause-reached', async (ev) => {
                try {
                  const idx = ev && ev.detail && typeof ev.detail.index === 'number' ? ev.detail.index : null;
                  const sid = window.currentSessionId || null;
                  if (sid == null || idx == null) return;
                  const key = `partialSubmitted_${sid}_${idx}`;
                  if (localStorage.getItem(key) === 'true') return; // avoid duplicate submissions for same checkpoint
                  const res = await submitPartial();
                  if (res && res.ok) { try { localStorage.setItem(key, 'true'); } catch(_){} }
                } catch(e){ console.warn('auto partial submit failed', e); }
              });
            } catch(e){}

            /* Controle de fonte (slider) */
            function initFontControl(){
              const fontRange = $('fontRange');
              const fontToggle = $('fontToggle');
              const fontSlider = $('fontSlider');

              // Se não houver controle de fonte na página (examFull), saia silenciosamente
              if (!fontRange || !fontSlider) return;

              fontRange.addEventListener('input', (e)=>{
                const v = e.target.value + 'px';
                document.documentElement.style.setProperty('--base-font-size', v);
                // reposicionar e readaptar tipografia
                requestAnimationFrame(()=>{ adaptQuestionTypography(); positionTimer(); });
              });

              // Botão de toggle é opcional; só conecte se existir
              if (fontToggle) {
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

              if (!timer) return;

              // Caso especial (examFull): quando o timer estiver na coluna esquerda do header,
              // não reposicionar via absoluto; manter fluxo normal evitando sobreposição.
              try {
                const inHeaderLeft = !!(timer.closest && timer.closest('.header-left'));
                if (inHeaderLeft) {
                  timer.style.position = '';
                  timer.style.left = '';
                  timer.style.top = '';
                  timer.style.transform = '';
                  return;
                }
              } catch(e) {}

              if (!center || !knowledge) return;

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
              const form = document.querySelector('#answersForm'); if (form) form.addEventListener('submit', (e)=> e.preventDefault());

              // Toggle de destaque (vermelho) da questão atual, persistido em localStorage por sessão
              const btnHL = $('bhighlight');
              if (btnHL) {
                btnHL.addEventListener('click', ()=>{
                  try {
                    const key = questionKeyFor(currentIdx);
                    const nowOn = !isHighlighted(key);
                    setHighlighted(key, nowOn);
                    applyHighlightUI(key);
                  } catch(e){}
                });
                // Garantir rótulo inicial consistente
                try { applyHighlightUI(questionKeyFor(currentIdx)); } catch(e){}
              }

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
                  // Initialize session-scoped pause flags at the start of a fresh exam (no prior progress/questions)
                  try {
                    const sid = window.currentSessionId || null;
                    if (sid) {
                      const hasProg = !!localStorage.getItem(`progress_${sid}`);
                      const hasQs = !!localStorage.getItem(`questions_${sid}`);
                      if (!hasProg && !hasQs) {
                        // Fresh exam start: initialize flags as false for this session
                        localStorage.setItem(`FirstStop_${sid}`, 'false');
                        localStorage.setItem(`SecondStop_${sid}`, 'false');
                      }
                    }
                  } catch(e){}
                  // attempt to fetch questions from backend
                  const count = Number(window.QtdQuestoes) || (localStorage.getItem('examQuestionCount') ? Number(localStorage.getItem('examQuestionCount')) : 0);
                  console.debug('[exam] QtdQuestoes=', window.QtdQuestoes, 'localStorage.examQuestionCount=', localStorage.getItem('examQuestionCount'));

                  // 1) Sempre tente usar o cache da sessão primeiro, independentemente de count
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

                  // 2) Sem cache: se não houver count, caia para exemplo local
                  if (!count) {
                    // fallback to sample questions
                    QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                    // normalize and freeze option order once
                    try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                    initExam();
                    return;
                  }

                  let token = localStorage.getItem('sessionToken') || '';
                  if (!token || token.endsWith('#')) {
                    const alt = localStorage.getItem('nomeUsuario') || localStorage.getItem('nome') || '';
                    if (alt) { try { localStorage.setItem('sessionToken', alt); } catch(e){} token = alt; }
                  }
                  console.debug('[exam] using sessionToken=', token);
                  const fetchUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE || '') + '/api/exams/select';
                  console.debug('[exam] fetching questions from', fetchUrl, 'count=', count);
                  // attach optional filters saved by examSetup (bypass when full exam)
                  let areas = null, grupos = null, dominios = null;
                  try {
                    const raw = localStorage.getItem('examFilters');
                    if (raw) {
                      const parsed = JSON.parse(raw);
                      if (parsed && typeof parsed === 'object') {
                        if (Array.isArray(parsed.areas)) areas = parsed.areas.map(Number).filter(n => !Number.isNaN(n));
                        if (Array.isArray(parsed.grupos)) grupos = parsed.grupos.map(Number).filter(n => !Number.isNaN(n));
                        if (Array.isArray(parsed.dominios)) dominios = parsed.dominios.map(Number).filter(n => !Number.isNaN(n));
                      }
                    }
                  } catch(e) { /* ignore parse errors */ }
                  const examType = (function(){ try { return localStorage.getItem('examType') || 'pmp'; } catch(e){ return 'pmp'; } })();
                  const payload = { count, examType };
                  const bypassFilters = (Number(count) === 180);
                  if (!bypassFilters) {
                    if (areas && areas.length) payload.areas = areas;
                    if (grupos && grupos.length) payload.grupos = grupos;
                    if (dominios && dominios.length) payload.dominios = dominios;
                  }
                  const resp = await fetch(fetchUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token, 'X-Exam-Type': examType },
                    body: JSON.stringify(payload)
                  });
                  if (!resp.ok) {
                    let available = null;
                    try {
                      const t = await resp.text();
                      try { const j = t ? JSON.parse(t) : null; if (j && typeof j.available === 'number') available = j.available; } catch(_){}
                    } catch(_){}
                    // Friendly handling when backend indicates not enough available
                    if (resp.status === 400 && typeof available === 'number') {
                      // Special fallback: if full exam requested (180) and available=0, retry ignoring exam_type constraint
                      if (bypassFilters && available === 0) {
                        try {
                          const resp2 = await fetch(fetchUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
                            body: JSON.stringify({ count, ignoreExamType: true })
                          });
                          if (resp2.ok) {
                            const data2 = await resp2.json();
                            // mimic normal success path by setting data and proceeding
                            const data = data2;
                            console.debug('[exam] fetched data (fallback ignoreExamType)', data && { total: data.total, questions: (data.questions||[]).length });
                            try {
                              if (data.exam && typeof data.exam === 'object') {
                                EXAM_BP = data.exam;
                                localStorage.setItem('examBlueprint', JSON.stringify(EXAM_BP));
                                if (typeof EXAM_BP.duracaoMinutos === 'number') {
                                  window.tempoExame = Number(EXAM_BP.duracaoMinutos);
                                  sessionStorage.setItem('tempoExame', JSON.stringify(Number(EXAM_BP.duracaoMinutos)));
                                }
                                if (typeof EXAM_BP.numeroQuestoes === 'number') {
                                  window.FullExam = Number(EXAM_BP.numeroQuestoes);
                                  sessionStorage.setItem('FullExam', JSON.stringify(Number(EXAM_BP.numeroQuestoes)));
                                }
                              }
                            } catch(e) { console.warn('failed to persist blueprint', e); }
                            try {
                              if (data.sessionId) {
                                const prev = window.currentSessionId;
                                migrateToServerSession(data.sessionId);
                                try {
                                  const sa = localStorage.getItem(`answers_${data.sessionId}_savedAt`);
                                  if (sa) updateAutosaveIndicatorSaved(sa);
                                  else updateAutosaveIndicatorHidden();
                                } catch(e) { updateAutosaveIndicatorHidden(); }
                              }
                            } catch(e){}
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
                            } catch(e){}
                            if (data && Array.isArray(data.questions) && data.questions.length) {
                              QUESTIONS = data.questions.map(q => ({
                                id: q.id,
                                type: q.type || null,
                                descricao: q.descricao,
                                explicacao: q.explicacao,
                                idprocesso: q.idprocesso,
                                text: q.descricao,
                                options: (q.options || []).map(o => ({ id: o.id || o.Id || null, text: (o.text || o.descricao || o.Descricao || '') }))
                              }));
                              try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                              try {
                                if (window.currentSessionId) {
                                  const qkey = `questions_${window.currentSessionId}`;
                                  if (!localStorage.getItem(qkey)) {
                                    localStorage.setItem(qkey, JSON.stringify(QUESTIONS));
                                    localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
                                  }
                                }
                              } catch(e){}
                            } else {
                              QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                            }
                            initExam();
                            return;
                          }
                        } catch(_) { /* ignore */ }
                      }
                      try {
                        const blocked = (localStorage.getItem('BloqueioAtivado') === 'true');
                        if (!blocked && available > 0) {
                          // Premium: autoajustar silenciosamente e tentar de novo
                          try { localStorage.setItem('examQuestionCount', String(available)); } catch(e){}
                          const statusEl = document.getElementById('status');
                          if (statusEl) { statusEl.style.display = ''; statusEl.textContent = 'Ajustando quantidade e carregando questões...'; }
                          await prepareAndInit();
                          return;
                        }

                        const statusEl = document.getElementById('status');
                        if (statusEl) {
                          statusEl.style.display = '';
                          const suggested = Math.min(available, 25);
                          if (available > 0 && suggested > 0) {
                            const btnId = 'adjustQtyBtn';
                            statusEl.innerHTML = `Não há questões suficientes para sua seleção. Disponíveis: <strong>${available}</strong>. Você pode iniciar com <strong>${suggested}</strong>. ` +
                              `<button id="${btnId}" style="margin-left:6px;background:#eef3ff;color:#2b6cb0;border:1px solid #c6d3ff;border-radius:6px;padding:4px 8px;cursor:pointer">Ajustar para ${suggested}</button>`;
                            const btn = document.getElementById(btnId);
                            if (btn) btn.onclick = async () => {
                              try { localStorage.setItem('examQuestionCount', String(suggested)); } catch(e){}
                              statusEl.textContent = 'Ajustando e carregando questões...';
                              await prepareAndInit();
                            };
                          } else {
                            // available === 0
                            const backId = 'backToSetupBtn';
                            statusEl.innerHTML = `Nenhuma questão encontrada para os filtros selecionados. ` +
                              `<button id="${backId}" style="margin-left:6px;background:#eef3ff;color:#2b6cb0;border:1px solid #c6d3ff;border-radius:6px;padding:4px 8px;cursor:pointer">Voltar à configuração</button>`;
                            const b = document.getElementById(backId);
                            if (b) b.onclick = () => { try { window.location.href = '/pages/examSetup.html'; } catch(_){} };
                          }
                        }
                      } catch(_){}
                      return; // stop here, do not initialize fallback questions
                    }
                    console.warn('Failed to fetch questions', resp.status);
                    // fallback to sample questions so the UI remains usable in other error cases
                    QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                    initExam();
                    return;
                  }
                  const data = await resp.json();
                  console.debug('[exam] fetched data', data && { total: data.total, questions: (data.questions||[]).length });
                  // if count came from default (user didn't inform), persist the effective quantity now
                  try {
                    const fromDefault = localStorage.getItem('examCountFromDefault');
                    if (fromDefault === 'true') {
                      const effective = (data && typeof data.total === 'number') ? data.total : ((data && Array.isArray(data.questions)) ? data.questions.length : null);
                      if (typeof effective === 'number' && effective > 0) {
                        localStorage.setItem('examQuestionCount', String(effective));
                      }
                      localStorage.removeItem('examCountFromDefault');
                    }
                  } catch(e) { /* ignore */ }
                  if (data && Array.isArray(data.questions) && data.questions.length) {
                    // Update blueprint from response if provided
                    try {
                      if (data.exam && typeof data.exam === 'object') {
                        EXAM_BP = data.exam;
                        localStorage.setItem('examBlueprint', JSON.stringify(EXAM_BP));
                        if (typeof EXAM_BP.duracaoMinutos === 'number') {
                          window.tempoExame = Number(EXAM_BP.duracaoMinutos);
                          sessionStorage.setItem('tempoExame', JSON.stringify(Number(EXAM_BP.duracaoMinutos)));
                        }
                        if (typeof EXAM_BP.numeroQuestoes === 'number') {
                          window.FullExam = Number(EXAM_BP.numeroQuestoes);
                          sessionStorage.setItem('FullExam', JSON.stringify(Number(EXAM_BP.numeroQuestoes)));
                        }
                      }
                    } catch(e) { console.warn('failed to persist blueprint', e); }
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
                      type: q.type || null,
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
          
