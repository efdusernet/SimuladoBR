// Protótipo atualizado: simulação com texto de 280 caracteres e ajuste automático de CSS
// Import controlled logging system
// <script src="/utils/logger.js"></script> must be loaded first in HTML

  // load questions from backend then initialize exam
            // QUESTIONS will be populated from the backend via /api/exams/select
            let QUESTIONS = [];
                      try {
                        const withImg = QUESTIONS.filter(q => q.imagem_url || q.imagemUrl);
                        if (withImg.length) {
                          window.logger?.debug('[exam] questions with image count', withImg.length) || logger.debug('[exam] questions with image count', withImg.length);
                          const q266 = withImg.find(q => q.id === 266);
                          if (q266) {
                            const rawImg = q266.imagem_url || q266.imagemUrl;
                            window.logger?.debug('[exam] q266 image len', rawImg ? rawImg.length : 0, 'startsWith(data:)?', /^data:/i.test(rawImg), 'prefix50', rawImg ? rawImg.slice(0,50) : null) || logger.debug('[exam] q266 image len', rawImg ? rawImg.length : 0, 'startsWith(data:)?', /^data:/i.test(rawImg), 'prefix50', rawImg ? rawImg.slice(0,50) : null);
                          }
                        } else {
                          window.logger?.debug('[exam] no questions have imagem_url/imagemUrl') || logger.debug('[exam] no questions have imagem_url/imagemUrl');
                        }
                      } catch(e) {}

            // store user selections: key by question id (or index) -> { index, optionId } or { indices:[], optionIds:[] }
            const ANSWERS = {};
            try { window.ANSWERS = ANSWERS; } catch(e){}

            // Debug/build stamp to confirm which script version is active in the browser.
            const EXAM_SCRIPT_VERSION = '20260116_11';
            try { window.__EXAM_SCRIPT_VERSION = EXAM_SCRIPT_VERSION; } catch(_){ }

            // Per-question feedback cache (used by "Conferir resposta" for advanced interactions)
            const MATCH_FEEDBACK = {};
            try { window.MATCH_FEEDBACK = MATCH_FEEDBACK; } catch(e){}

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

            // Memoization cache for shuffled options: prevents repeated shuffling on every render
            const shuffledOptionsCache = new Map();

            // Load cached shuffle order from sessionStorage (persists across page reloads)
            function loadShuffleCache(){
              try {
                if (!window.currentSessionId) return;
                const key = `shuffleCache_${window.currentSessionId}`;
                const raw = sessionStorage.getItem(key);
                if (raw) {
                  const parsed = JSON.parse(raw);
                  if (parsed && typeof parsed === 'object') {
                    Object.keys(parsed).forEach(qId => {
                      shuffledOptionsCache.set(qId, parsed[qId]);
                    });
                  }
                }
              } catch(e) { logger.warn('[shuffle] Failed to load cache', e); }
            }

            // Save shuffle cache to sessionStorage for persistence
            function saveShuffleCache(){
              try {
                if (!window.currentSessionId || shuffledOptionsCache.size === 0) return;
                const key = `shuffleCache_${window.currentSessionId}`;
                const obj = {};
                shuffledOptionsCache.forEach((value, qId) => { obj[qId] = value; });
                sessionStorage.setItem(key, JSON.stringify(obj));
              } catch(e) { logger.warn('[shuffle] Failed to save cache', e); }
            }

            // Normalize question options to shape { id, text } and ensure a single shuffled order
            // Uses memoization to prevent repeated shuffles on every render
            function ensureShuffledOptionsForQuestion(q){
              if (!q) return q;
              
              // Generate unique cache key for this question
              const qId = (q.id !== undefined && q.id !== null) ? `q_${q.id}` : `idx_${QUESTIONS.indexOf(q)}`;
              
              // normalize options to {id, text}
              const rawOpts = Array.isArray(q.options) ? q.options : [];
              const normalized = rawOpts.map(o => {
                if (!o) return { id: null, text: '' };
                if (typeof o === 'string') return { id: null, text: o };
                return { id: (o.id || o.Id || null), text: (o.text || o.descricao || o.Descricao || o.Descricao || '') };
              });
              q.options = normalized;
              
              // Check memoization cache first (fastest path)
              if (shuffledOptionsCache.has(qId)) {
                q.shuffledOptions = shuffledOptionsCache.get(qId);
                return q;
              }
              
              // Check if already shuffled on the question object
              if (Array.isArray(q.shuffledOptions) && q.shuffledOptions.length === normalized.length) {
                shuffledOptionsCache.set(qId, q.shuffledOptions);
                return q;
              }
              
              // Only shuffle if not cached - this should happen once per question per session
              q.shuffledOptions = shuffleArray(normalized);
              shuffledOptionsCache.set(qId, q.shuffledOptions);
              return q;
            }

            function ensureShuffledOptionsForAll(questionsArray){
              try {
                if (!Array.isArray(questionsArray)) return;
                
                // Load cache once before processing all questions
                if (shuffledOptionsCache.size === 0) {
                  loadShuffleCache();
                }
                
                for (let i = 0; i < questionsArray.length; i++) {
                  ensureShuffledOptionsForQuestion(questionsArray[i]);
                }
                
                // Save cache after shuffling all questions
                saveShuffleCache();
              } catch(e) { logger.warn('ensureShuffledOptionsForAll failed', e); }
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
              } catch(e) { logger.warn('saveAnswersForCurrentSession failed', e); }
            }

            function normalizeQuestionsAndMigrateAnswers(questions){
              try {
                if (!Array.isArray(questions)) return questions;
                for (let i = 0; i < questions.length; i++) {
                  const q = questions[i];
                  if (!q || typeof q !== 'object') continue;

                  // Normalize id field (some payloads/caches use Id)
                  if ((q.id === undefined || q.id === null) && (q.Id !== undefined && q.Id !== null)) {
                    try { q.id = q.Id; } catch(_){ }
                  }

                  // Normalize type field (some payloads/caches use tiposlug)
                  if ((q.type === undefined || q.type === null || String(q.type).trim() === '') && (q.tiposlug || q.tipoSlug || q.TipoSlug)) {
                    try { q.type = q.tiposlug || q.tipoSlug || q.TipoSlug; } catch(_){ }
                  }

                  // Normalize interaction spec field
                  if (!q.interacao && (q.interaction || q.interacaospec)) {
                    try { q.interacao = q.interaction || q.interacaospec; } catch(_){ }
                  }

                  // Migrate any existing idx-based answers to id-based keys once an id becomes available.
                  try {
                    const hasId = (q.id !== undefined && q.id !== null && String(q.id).trim() !== '');
                    if (!hasId) continue;
                    const idKey = `q_${q.id}`;
                    const idxKey = `idx_${i}`;
                    if (ANSWERS && ANSWERS[idxKey] && !ANSWERS[idKey]) {
                      ANSWERS[idKey] = ANSWERS[idxKey];
                    }
                  } catch(_){ }
                }
              } catch(_){ }
              return questions;
            }

            function getInteractionSpec(q){
              try {
                if (!q || typeof q !== 'object') return null;
                return (q.interacao || q.interaction || q.interacaospec) || null;
              } catch(_){
                return null;
              }
            }

            function inferQuestionType(q){
              try {
                const raw = (q && (q.type || q.tiposlug || q.tipoSlug || q.TipoSlug)) || '';
                const t = (typeof raw === 'string') ? raw.trim().toLowerCase() : '';
                if (t) return t;

                const spec = getInteractionSpec(q);
                const kind = (spec && typeof spec.kind === 'string') ? spec.kind.trim().toLowerCase() : '';
                if (kind) return kind;

                // Heuristic: match_columns spec usually has left/right arrays.
                const left = Array.isArray(spec && spec.left) ? spec.left : null;
                const right = Array.isArray(spec && spec.right) ? spec.right : null;
                if (left && right && left.length && right.length) return 'match_columns';
              } catch(_){ }
              return '';
            }

            function allQuestionsHaveValidIds(questions){
              try {
                if (!Array.isArray(questions) || !questions.length) return false;
                return questions.every(q => {
                  const raw = (q && (q.id ?? q.Id ?? q.questionId ?? q.QuestionId ?? q.question_id ?? q.questionID)) ?? null;
                  const n = Number(raw);
                  return Number.isFinite(n) && n > 0;
                });
              } catch(_){
                return false;
              }
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

            function persistLastSubmitError(obj){
              try { window.__lastSubmitError = obj; } catch(_){ }
              try {
                if (obj != null) {
                  localStorage.setItem('lastSubmitError', JSON.stringify(obj, null, 2));
                  localStorage.setItem('lastSubmitErrorSavedAt', new Date().toISOString());
                }
              } catch(_){ }
            }

            function renderPersistentSubmitError(errMsg, detailsObj){
              try {
                const status = $('status');
                const hasStatus = !!status;
                if (hasStatus) {
                  status.style.display = '';
                  status.innerHTML = '';
                }

                const title = document.createElement('div');
                title.style.fontWeight = '700';
                title.style.marginBottom = '6px';
                title.style.color = '#b91c1c';
                title.textContent = 'Erro ao enviar respostas';

                const msg = document.createElement('div');
                msg.style.marginBottom = '10px';
                msg.textContent = `${errMsg} (script v=${EXAM_SCRIPT_VERSION})`;

                if (hasStatus) {
                  status.appendChild(title);
                  status.appendChild(msg);
                }

                const detailsRow = document.createElement('div');
                detailsRow.style.display = 'flex';
                detailsRow.style.gap = '8px';
                detailsRow.style.alignItems = 'center';
                detailsRow.style.marginBottom = '8px';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = 'Copiar detalhes';
                btn.style.cssText = 'background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;border-radius:8px;padding:6px 10px;cursor:pointer;font-weight:700;';

                const hint = document.createElement('div');
                hint.style.color = '#475569';
                hint.style.fontSize = '.85rem';
                try {
                  const savedAt = localStorage.getItem('lastSubmitErrorSavedAt') || '';
                  hint.textContent = savedAt ? ('salvo em lastSubmitError às ' + savedAt) : 'salvo em lastSubmitError';
                } catch(_){ hint.textContent = 'salvo em lastSubmitError'; }

                detailsRow.appendChild(btn);
                detailsRow.appendChild(hint);
                if (hasStatus) status.appendChild(detailsRow);

                const pre = document.createElement('pre');
                pre.style.whiteSpace = 'pre-wrap';
                pre.style.wordBreak = 'break-word';
                pre.style.maxHeight = '260px';
                pre.style.overflow = 'auto';
                pre.style.padding = '10px';
                pre.style.border = '1px solid #e5e7eb';
                pre.style.borderRadius = '10px';
                pre.style.background = '#fff';
                let txt = '';
                try { txt = JSON.stringify(detailsObj, null, 2); } catch(_){ txt = String(detailsObj); }
                pre.textContent = txt;
                if (hasStatus) status.appendChild(pre);

                btn.addEventListener('click', async ()=>{
                  try {
                    const text = pre.textContent || '';
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                      await navigator.clipboard.writeText(text);
                      try { showToast('Detalhes copiados.', 1400, true); } catch(_){ }
                      return;
                    }
                  } catch(_){ }
                  // Fallback: select and copy
                  try {
                    const ta = document.createElement('textarea');
                    ta.value = pre.textContent || '';
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    try { showToast('Detalhes copiados.', 1400, true); } catch(_){ }
                  } catch(_){
                    try { showToast('Não foi possível copiar automaticamente.', 1800, true); } catch(__){ }
                  }
                });

                // Fallback UI: if #status isn't available/visible, show a modal overlay with the same content.
                if (!hasStatus) {
                  try {
                    const existing = document.getElementById('submitErrorModal');
                    if (existing) existing.remove();

                    const modal = document.createElement('div');
                    modal.id = 'submitErrorModal';
                    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;';

                    const panel = document.createElement('div');
                    panel.style.cssText = 'width:min(920px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:14px;border:1px solid #e5e7eb;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:14px;';

                    const top = document.createElement('div');
                    top.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;';

                    const left = document.createElement('div');
                    left.appendChild(title);
                    left.appendChild(msg);

                    const closeBtn = document.createElement('button');
                    closeBtn.type = 'button';
                    closeBtn.textContent = 'Fechar';
                    closeBtn.style.cssText = 'background:#fff;color:#0f172a;border:1px solid #0f172a;border-radius:10px;padding:6px 10px;cursor:pointer;font-weight:700;';
                    closeBtn.addEventListener('click', ()=>{ try { modal.remove(); } catch(_){ } });

                    top.appendChild(left);
                    top.appendChild(closeBtn);
                    panel.appendChild(top);
                    panel.appendChild(detailsRow);
                    panel.appendChild(pre);
                    modal.appendChild(panel);

                    modal.addEventListener('click', (e)=>{ if (e.target === modal) { try { modal.remove(); } catch(_){ } } });
                    document.body.appendChild(modal);
                  } catch(_){ }
                }
              } catch(_){ }
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
              } catch(e) { logger.warn('saveProgressForCurrentSession failed', e); }
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
              } catch(e) { logger.warn('migrateToServerSession failed', e); }
            }

            // Diagnostic: indicate the file was loaded
            try {
              logger.debug('[exam] script_exam.js loaded');
            } catch(e) {}

            // Global error handler to surface runtime errors in console (helps detect silent failures)
            window.addEventListener && window.addEventListener('error', function (ev) {
              try { logger.error('[exam] window error:', ev && ev.message, ev && ev.filename, ev && ev.lineno, ev && ev.error); } catch(e){}
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
                try { const ac = document.getElementById('answersContainer'); if (ac) { while(ac.firstChild) ac.removeChild(ac.firstChild); } } catch(e){}
                try { const idSpan = document.getElementById('questionIdDisplay'); if (idSpan) idSpan.textContent = ''; } catch(_){}
                return;
              }
              // manter "Exemplo" fixo no header conforme solicitado; apenas atualizamos número e texto
              $('questionNumber').textContent = idx + 1;
              $('totalQuestions').textContent = QUESTIONS.length;
              // Use DOMPurify sanitization from utils/sanitize.js
              try {
                const rawDesc = q.text || q.descricao || '';
                if (containsHTML(rawDesc)) {
                  const qt = document.getElementById('questionText');
                  if (qt) qt.innerHTML = sanitizeHTML(rawDesc); else $('questionText').textContent = rawDesc;
                } else {
                  $('questionText').textContent = rawDesc;
                }
              } catch(_) { $('questionText').textContent = q.text || q.descricao || ''; }
              try { const idSpan = document.getElementById('questionIdDisplay'); if (idSpan) idSpan.textContent = (q && q.id != null) ? `ID: ${q.id}` : ''; } catch(_){}

              // Change Continue button to "Enviar" at question 180 (1-based)
              try {
                const contBtn = $('continueBtn');
                if (contBtn) {
                  const labelNum = idx + 1; // 1-based label
                  if (labelNum === 180) {
                    contBtn.textContent = 'Enviar';
                    contBtn.style.background = '#10b981'; // Green color for submit
                  } else {
                    contBtn.textContent = 'Continuar';
                    contBtn.style.background = ''; // Reset to default
                  }
                }
              } catch(_){ }

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

              // Tracks whether this question rendered a custom interaction UI (vs. radio/checkbox list)
              let renderedAnswers = false;

              // Diagnostic log for first render of each question (once)
              try {
                if (!q.__logged) { logger.debug('[exam] renderQuestion idx', idx, 'id', q.id, 'has imagem_url?', !!(q.imagem_url||q.imagemUrl)); q.__logged = true; }
              } catch(_){}

              // Advanced type: match_columns
              try {
                const qType = inferQuestionType(q);
                if (qType === 'match_columns') {
                  const ac = document.getElementById('answersContainer');
                  if (ac) ac.innerHTML = '';

                  const spec = getInteractionSpec(q);
                  if (!spec || !window.MatchColumns || typeof window.MatchColumns.create !== 'function') {
                    if (ac) ac.textContent = 'Interação indisponível.';
                    renderedAnswers = true;
                    try { const contBtn = $('continueBtn'); if (contBtn) contBtn.disabled = true; } catch(_){ }
                    // continue so the rest of the UI (back button, etc) still updates
                  } else {
                    const prev = ANSWERS[qKey];
                    const prevPairs = (prev && prev.response && prev.response.pairs && typeof prev.response.pairs === 'object') ? prev.response.pairs : null;

                    function isAnswered(pairs){
                      try {
                        const left = Array.isArray(spec && spec.left) ? spec.left : [];
                        if (!left.length) return false;
                        const p = (pairs && typeof pairs === 'object') ? pairs : {};
                        return left.every(it => {
                          const lid = String(it && it.id);
                          const rid = p[lid];
                          return rid != null && String(rid).trim() !== '';
                        });
                      } catch(_){ return false; }
                    }

                    function setContinueDisabled(answered){
                      try {
                        const contBtn = $('continueBtn');
                        if (!contBtn) return;
                        const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                        const isCheckpoint = cps.includes(idx);
                        const isExtraGate = (idx === 59 || idx === 119);
                        const allowOverride = isContinueOverrideEnabled();
                        const inPause = isPauseActive();
                        const gate = (isCheckpoint || isExtraGate) && !allowOverride;
                        contBtn.disabled = inPause || gate || !answered;
                      } catch(_){ }
                    }

                    function renderFeedback(){
                      try {
                        const data = MATCH_FEEDBACK[qKey];
                        if (!data) return;
                        const root = document.createElement('div');
                        root.style.marginTop = '12px';
                        root.style.padding = '10px';
                        root.style.border = '1px solid #e5e7eb';
                        root.style.borderRadius = '10px';
                        root.style.background = '#fff';
                        const title = document.createElement('div');
                        title.style.fontWeight = '700';
                        title.style.marginBottom = '6px';
                        title.textContent = 'Conferência';
                        root.appendChild(title);

                        try {
                          const reason = data && data.gradeReason ? String(data.gradeReason) : '';
                          if (reason && data && data.isCorrect !== true) {
                            const info = document.createElement('div');
                            info.style.marginBottom = '8px';
                            info.style.color = '#64748b';
                            info.style.fontSize = '.85rem';
                            info.textContent = 'Motivo (debug): ' + reason;
                            root.appendChild(info);
                          }
                        } catch(_){ }

                        const left = Array.isArray(spec.left) ? spec.left : [];
                        const right = Array.isArray(spec.right) ? spec.right : [];
                        const rightById = new Map(right.map(r => [String(r.id), r]));
                        const userPairs = (data && data.userPairs && typeof data.userPairs === 'object') ? data.userPairs : {};
                        const correctPairs = (data && data.correctPairs && typeof data.correctPairs === 'object') ? data.correctPairs : {};

                        left.forEach(item => {
                          const lid = String(item && item.id);
                          const ltxt = String(item && item.text || '');
                          const ur = userPairs[lid];
                          const cr = correctPairs[lid];
                          const uTxt = ur ? String((rightById.get(String(ur)) || {}).text || '') : '';
                          const cTxt = cr ? String((rightById.get(String(cr)) || {}).text || '') : '';
                          const ok = (ur != null && cr != null && String(ur) === String(cr));

                          const row = document.createElement('div');
                          row.style.display = 'grid';
                          row.style.gridTemplateColumns = '1fr 1fr';
                          row.style.gap = '10px';
                          row.style.padding = '6px 0';
                          row.style.borderTop = '1px solid #f1f5f9';

                          const a = document.createElement('div');
                          a.textContent = ltxt;

                          const b = document.createElement('div');
                          b.textContent = ok ? uTxt : (uTxt ? (uTxt + ' (correta: ' + cTxt + ')') : ('(vazio) (correta: ' + cTxt + ')'));
                          b.style.color = ok ? '#16a34a' : '#b91c1c';

                          row.appendChild(a);
                          row.appendChild(b);
                          root.appendChild(row);
                        });

                        ac.appendChild(root);
                      } catch(_){ }
                    }

                    const mcInst = window.MatchColumns.create(ac, spec, {
                      mode: 'exam',
                      valuePairs: prevPairs,
                      onChange: (val)=>{
                        try {
                          try { delete MATCH_FEEDBACK[qKey]; } catch(_){ }
                          // Store redundantly to be resilient to older shapes / partial migrations
                          const pairs = (val && val.pairs && typeof val.pairs === 'object') ? val.pairs : null;
                          ANSWERS[qKey] = { response: val, pairs };
                          try { saveAnswersForCurrentSession(); } catch(_){ }
                          setContinueDisabled(isAnswered(pairs));
                          try { const qc = $('questionContent'); if (qc) qc.classList.remove('input-error'); } catch(_){ }
                        } catch(e) {
                          try { logger.warn('[exam] match_columns onChange failed', e); } catch(_){ }
                        }
                      }
                    });

                    // Keep a handle to the widget instance so we can always read current pairs at submit time.
                    try {
                      if (!window.__mcInstances) window.__mcInstances = {};
                      window.__mcInstances[qKey] = mcInst;
                    } catch(_){ }

                    setContinueDisabled(isAnswered(prevPairs));
                    renderFeedback();
                    renderedAnswers = true;
                  }
                }
              } catch(_){ }

              if (!renderedAnswers) {
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
                  // Requisito adicional: ao chegar nos índices 59 e 119 (0-based; rótulo 60 e 120),
                  // desabilitar também como se fossem checkpoints, a menos que haja override.
                  const isExtraGate = (idx === 59 || idx === 119);
                  let disabled = inPause || ((isCheckpoint || isExtraGate) && !allowOverride);
                  try {
                    const qType = inferQuestionType(q);
                    if (qType === 'match_columns') {
                      const spec = getInteractionSpec(q);
                      const left = Array.isArray(spec && spec.left) ? spec.left : [];
                      const prev = ANSWERS[qKey];
                      const pairs = (prev && prev.response && prev.response.pairs && typeof prev.response.pairs === 'object') ? prev.response.pairs : {};
                      const answered = left.length > 0 && left.every(it => {
                        const lid = String(it && it.id);
                        const rid = pairs[lid];
                        return rid != null && String(rid).trim() !== '';
                      });
                      if (!answered) disabled = true;
                    }
                  } catch(_){ }
                  contBtn.disabled = disabled;
                  // Ao chegar na última questão, alterar rótulo para "Enviar"
                  try {
                    const total = Array.isArray(QUESTIONS) ? QUESTIONS.length : 0;
                    if (total > 0) {
                      const isLast = (idx === total - 1);
                      if (isLast) {
                        contBtn.textContent = 'Enviar';
                        contBtn.style.background = '#10b981'; // Green color for submit
                      } else {
                        contBtn.textContent = 'Continuar';
                        contBtn.style.background = ''; // Reset to default
                      }
                    }
                  } catch(_){}
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

            // Show a warning banner when a full exam starts without pretest questions
            // (expectedTotal - returnedTotal === 5 and no questions are marked as pretest)
            function updatePretestWarning(examSelectResponse, mappedQuestions){
              try {
                const el = document.getElementById('pretestWarning');
                if (!el) return;

                const mode = (examSelectResponse && examSelectResponse.examMode != null) ? String(examSelectResponse.examMode).toLowerCase() : '';
                if (mode !== 'full') { el.style.display = 'none'; return; }

                const expectedTotal = (examSelectResponse && examSelectResponse.exam && typeof examSelectResponse.exam.numeroQuestoes === 'number')
                  ? Number(examSelectResponse.exam.numeroQuestoes)
                  : (function(){ try { return Number(localStorage.getItem('examQuestionCount')) || 0; } catch(_){ return 0; } })();

                const returnedTotal = (examSelectResponse && typeof examSelectResponse.total === 'number')
                  ? Number(examSelectResponse.total)
                  : (Array.isArray(mappedQuestions) ? mappedQuestions.length : 0);

                const qs = Array.isArray(mappedQuestions) ? mappedQuestions : [];
                const pretestCount = qs.filter(q => q && (q._isPreTest === true || q.isPreTest === true)).length;

                // Only show this specific warning when the shortage matches the pretest target and none exist.
                const missingPretest = expectedTotal > 0 && returnedTotal > 0 && (expectedTotal - returnedTotal) === 5 && pretestCount === 0;
                el.style.display = missingPretest ? '' : 'none';
              } catch(_){ }
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
              // Best-effort capture for match_columns before moving on.
              try {
                const q = QUESTIONS[currentIdx];
                const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${currentIdx}`;
                const qType = inferQuestionType(q);
                if (qType === 'match_columns') {
                  const inst = (window.__mcInstances && window.__mcInstances[qKey]) ? window.__mcInstances[qKey] : null;
                  const v = inst && typeof inst.getValue === 'function' ? inst.getValue() : null;
                  const pairs = (v && v.pairs && typeof v.pairs === 'object') ? v.pairs : null;
                  if (pairs) {
                    ANSWERS[qKey] = { response: { pairs }, pairs };
                    try { saveAnswersForCurrentSession(); } catch(_){ }
                  }
                }
              } catch(_){ }

              if (currentIdx < QUESTIONS.length - 1){
                currentIdx++;
                renderQuestion(currentIdx);
                try{ saveProgressForCurrentSession(); } catch(e){}
              } else {
                // end of exam: collect answers and submit to backend
                clearInterval(timerInterval);
                submitExam().catch(err=>{
                  try { logger.error('submitExam error', err); alert('Erro ao enviar respostas.'); } catch(e){}
                });
              }
            }

            // Expose a best-effort snapshot helper so other UI (e.g., Grid de questões) can
            // persist the current question's answer state before opening overlays.
            async function captureCurrentAnswerSnapshot(){
              try {
                const idx = (typeof currentIdx === 'number') ? currentIdx : 0;
                const q = (Array.isArray(QUESTIONS) && QUESTIONS[idx]) ? QUESTIONS[idx] : null;
                if (!q) return { ok: false, reason: 'no_question' };
                const qIdRaw = (q && (q.id ?? q.Id ?? q.questionId ?? q.QuestionId ?? q.question_id ?? q.questionID)) ?? null;
                const qid = (qIdRaw != null && String(qIdRaw).trim() !== '') ? Number(qIdRaw) : null;
                const idKey = (Number.isFinite(qid) && qid > 0) ? `q_${qid}` : null;
                const idxKey = `idx_${idx}`;
                const qKey = idKey || idxKey;
                const qType = inferQuestionType(q);
                if (qType === 'match_columns') {
                  const spec = getInteractionSpec(q);

                  function normalizePairs(p){
                    const out = {};
                    if (!p || typeof p !== 'object') return out;
                    for (const k of Object.keys(p)) {
                      const key = String(k).trim();
                      const v = p[k];
                      if (!key) continue;
                      if (v == null) { out[key] = null; continue; }
                      const s = String(v).trim();
                      out[key] = s ? s : null;
                    }
                    return out;
                  }

                  function isComplete(pairs){
                    try {
                      const left = Array.isArray(spec && spec.left) ? spec.left : [];
                      if (!left.length) return Object.keys(pairs || {}).length > 0;
                      const p = (pairs && typeof pairs === 'object') ? pairs : {};
                      return left.every(it => {
                        const lid = String(it && it.id);
                        const rid = p[lid];
                        return rid != null && String(rid).trim() !== '';
                      });
                    } catch(_){ return false; }
                  }

                  const inst = (window.__mcInstances && (window.__mcInstances[qKey] || (idKey && window.__mcInstances[idxKey])))
                    ? (window.__mcInstances[qKey] || (idKey ? window.__mcInstances[idxKey] : null))
                    : null;
                  const v = inst && typeof inst.getValue === 'function' ? inst.getValue() : null;
                  const pairs = (v && v.pairs && typeof v.pairs === 'object') ? normalizePairs(v.pairs) : null;
                  if (pairs && isComplete(pairs)) {
                    ANSWERS[qKey] = { response: { pairs }, pairs: pairs };
                    if (idKey && qKey !== idxKey && ANSWERS[idxKey] && !ANSWERS[idKey]) {
                      try { ANSWERS[idKey] = ANSWERS[qKey]; } catch(_){ }
                    }
                    try { saveAnswersForCurrentSession(); } catch(_){ }
                    return { ok: true, type: 'match_columns', key: qKey };
                  }
                  return { ok: false, type: 'match_columns', key: qKey, reason: 'no_pairs' };
                }
                // For non-typed questions, we already store on change; just ensure persisted.
                try { saveAnswersForCurrentSession(); } catch(_){ }
                return { ok: true, type: qType || 'unknown', key: qKey };
              } catch (e) {
                return { ok: false, reason: String(e && e.message || e) };
              }
            }

            async function submitExam(){
              try {
                const answers = [];
                for (let i = 0; i < QUESTIONS.length; i++){
                  const q = QUESTIONS[i];
                  const qIdRaw = (q && (q.id ?? q.Id ?? q.questionId ?? q.QuestionId ?? q.question_id ?? q.questionID)) ?? null;
                  const questionId = (qIdRaw != null && String(qIdRaw).trim() !== '') ? Number(qIdRaw) : null;
                  if (!Number.isFinite(questionId) || questionId <= 0) {
                    const msg = 'Questão sem ID válido no envio. Atualize a página e tente novamente.';
                    console.error('Question missing id at submit', { index: i, q });
                    try { showToast(msg, 2600, true); } catch(_){ }
                    throw new Error(msg);
                  }
                  const idKey = (Number.isFinite(questionId) && questionId > 0) ? `q_${questionId}` : null;
                  const idxKey = `idx_${i}`;
                  const qKey = idKey || idxKey;
                  let a = (ANSWERS && ANSWERS[qKey]) ? ANSWERS[qKey] : null;
                  if (!a && idKey && ANSWERS && ANSWERS[idxKey]) {
                    a = ANSWERS[idxKey];
                    // migrate so future reads use the id-based key
                    try { ANSWERS[idKey] = a; } catch(_){ }
                  }
                  const qType = inferQuestionType(q);
                  const mcInst = (window.__mcInstances && (window.__mcInstances[qKey] || (idKey && window.__mcInstances[idxKey])))
                    ? (window.__mcInstances[qKey] || (idKey ? window.__mcInstances[idxKey] : null))
                    : null;
                  const isMatchColumns = (qType === 'match_columns') || (!!(mcInst && typeof mcInst.getValue === 'function'));

                  if (isMatchColumns) {
                    const obj = { questionId };
                    const spec = getInteractionSpec(q);

                    function normalizePairs(p){
                      const out = {};
                      if (!p || typeof p !== 'object') return out;
                      for (const k of Object.keys(p)) {
                        const key = String(k).trim();
                        const v = p[k];
                        if (!key) continue;
                        if (v == null) { out[key] = null; continue; }
                        const s = String(v).trim();
                        out[key] = s ? s : null;
                      }
                      return out;
                    }

                    function isComplete(pairs){
                      try {
                        const left = Array.isArray(spec && spec.left) ? spec.left : [];
                        if (!left.length) return Object.keys(pairs || {}).length > 0;
                        const p = (pairs && typeof pairs === 'object') ? pairs : {};
                        return left.every(it => {
                          const lid = String(it && it.id);
                          const rid = p[lid];
                          return rid != null && String(rid).trim() !== '';
                        });
                      } catch(_){ return false; }
                    }

                    // Be resilient to older/localStorage shapes:
                    // - { response: { pairs: {...} } }
                    // - { pairs: {...} }
                    // - direct { pairs: {...} }
                    let pairsFromStorage = null;
                    try {
                      let resp = null;
                      if (a && a.response && typeof a.response === 'object') resp = a.response;
                      else if (a && a.pairs && typeof a.pairs === 'object') resp = { pairs: a.pairs };
                      else if (a && typeof a === 'object' && a.pairs && typeof a.pairs === 'object') resp = a;
                      if (resp && typeof resp === 'string') {
                        try { resp = JSON.parse(resp); } catch(_){ }
                      }
                      const p = (resp && typeof resp === 'object' && resp.pairs && typeof resp.pairs === 'object') ? resp.pairs : (resp && typeof resp === 'object' ? resp : null);
                      if (p && typeof p === 'object') pairsFromStorage = normalizePairs(p);
                    } catch(_){ pairsFromStorage = null; }

                    // Always read directly from the widget instance (source of truth for current UI state).
                    let pairsFromWidget = null;
                    try {
                      const v = mcInst && typeof mcInst.getValue === 'function' ? mcInst.getValue() : null;
                      const p = (v && v.pairs && typeof v.pairs === 'object') ? v.pairs : null;
                      if (p) pairsFromWidget = normalizePairs(p);
                    } catch(_){ pairsFromWidget = null; }

                    const widgetOk = pairsFromWidget && isComplete(pairsFromWidget);
                    const storageOk = pairsFromStorage && isComplete(pairsFromStorage);
                    const pairs = widgetOk ? pairsFromWidget : (storageOk ? pairsFromStorage : (pairsFromWidget || pairsFromStorage));

                    if (!Number.isFinite(questionId) || questionId <= 0) {
                      const msg = 'Questão sem ID válido no envio (match_columns). Atualize a página e tente novamente.';
                      try { showToast(msg, 2600, true); } catch(_){ }
                      throw new Error(msg);
                    }
                    if (!pairs || !isComplete(pairs)) {
                      const msg = `Resposta de associação incompleta na questão ID ${questionId}. Volte e confirme todos os pareamentos.`;
                      try { showToast(msg, 2600, true); } catch(_){ }
                      throw new Error(msg);
                    }

                    // Persist the final normalized pairs we are about to submit.
                    try {
                      ANSWERS[qKey] = { response: { pairs }, pairs };
                      if (idKey && qKey !== idxKey && ANSWERS[idxKey] && !ANSWERS[idKey]) {
                        ANSWERS[idKey] = ANSWERS[qKey];
                      }
                      saveAnswersForCurrentSession();
                    } catch(_){ }

                    obj.response = { pairs };
                    answers.push(obj);
                    continue;
                  }
                  const isMulti = (function(){
                    try { if (q && typeof q.type === 'string') { const t = q.type.toLowerCase(); return (t === 'checkbox' || t === 'multi' || t === 'multiple'); } } catch(e){}
                    return !!(EXAM_BP && EXAM_BP.multiplaSelecao);
                  })();
                  if (isMulti) {
                    const optionIds = Array.isArray(a && a.optionIds) ? a.optionIds.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
                    const obj = { questionId };
                    if (optionIds.length) obj.optionIds = optionIds;
                    answers.push(obj);
                  } else {
                    const optionId = (a && a.optionId != null && String(a.optionId).trim() !== '') ? Number(a.optionId) : null;
                    const obj = { questionId };
                    if (Number.isFinite(optionId) && optionId > 0) obj.optionId = optionId;
                    answers.push(obj);
                  }
                }

                const payload = { sessionId: window.currentSessionId || null, answers, clientScriptVersion: (typeof EXAM_SCRIPT_VERSION !== 'undefined') ? EXAM_SCRIPT_VERSION : null };
                const token = localStorage.getItem('sessionToken') || '';
                // Ensure BACKEND_BASE has a proper default value
                const baseUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || 'http://localhost:3000';
                const submitUrl = baseUrl.replace(/\/$/, '') + '/api/exams/submit';
                const resp = await fetch(submitUrl, {
                  method: 'POST',
                  headers: (() => { const h = { 'Content-Type': 'application/json', 'X-Session-Token': token }; try { h['X-Client-Script-Version'] = (typeof EXAM_SCRIPT_VERSION !== 'undefined') ? String(EXAM_SCRIPT_VERSION) : ''; } catch(_){} try { const examType = (localStorage.getItem('examType')||'').trim(); if (examType) h['X-Exam-Type'] = examType; const jwtTok = (localStorage.getItem('jwt')||'').trim(); const jwtType = (localStorage.getItem('jwt_type')||'Bearer').trim(); if (jwtTok) h['Authorization'] = `${jwtType} ${jwtTok}`; } catch(_){} return h; })(),
                  body: JSON.stringify(payload),
                  credentials: 'include'
                });
                if (!resp.ok) {
                  let extra = '';
                  let parsed = null;
                  try {
                    const ct = String(resp.headers.get('content-type') || '').toLowerCase();
                    if (ct.includes('application/json')) {
                      const j = await resp.json();
                      parsed = j;
                      const msg = (j && (j.message || j.error || j.msg)) ? String(j.message || j.error || j.msg) : '';
                      const code = (j && (j.code || j.errorCode)) ? String(j.code || j.errorCode) : '';
                      const missing = (j && j.details && Array.isArray(j.details.missing)) ? j.details.missing : null;
                      const received = (j && j.details && Array.isArray(j.details.receivedQuestionIds)) ? j.details.receivedQuestionIds : null;
                      extra = [
                        code,
                        msg,
                        (missing ? ('missing=' + JSON.stringify(missing)) : ''),
                        (received ? ('receivedQuestionIds=' + JSON.stringify(received)) : '')
                      ].filter(Boolean).join(' | ');
                    } else {
                      const t = await resp.text();
                      extra = t ? String(t).slice(0, 300) : '';
                    }
                  } catch(_){ }
                  const errMsg = 'submit failed: ' + resp.status + (extra ? (' - ' + extra) : '');
                  try { persistLastSubmitError(parsed || { status: resp.status, extra }); } catch(_){ }
                  try { renderPersistentSubmitError(errMsg, parsed || { status: resp.status, extra }); } catch(_){ }
                  try {
                    console.error('[submit] error details saved', {
                      status: resp.status,
                      scriptVersion: (typeof EXAM_SCRIPT_VERSION !== 'undefined') ? EXAM_SCRIPT_VERSION : null,
                      parsed
                    });
                    console.error('[submit] You can copy from localStorage.lastSubmitError or window.__lastSubmitError');
                  } catch(_){ }
                  try { showToast(errMsg + ' (detalhes no painel)', 2600, true); } catch(_){ }
                  throw new Error(errMsg);
                }
                const data = await resp.json();

                // show results in #status area
                try {
                  const status = $('status');
                  if (status) {
                    status.style.display = '';
                    status.textContent = `Resultado: ${data.totalCorrect} / ${data.totalQuestions} questões corretas.`;
                  } else {
                    try { showToast(`Resultado: ${data.totalCorrect} / ${data.totalQuestions}`, 1800, true); } catch(_){ /* fallback */ }
                  }
                } catch(e){ logger.warn('show result failed', e); }

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

                // Calcular performance e redirecionar para examPmiResults.html (exames >=180 questões)
                const totalQuestions = data.totalQuestions || 0;
                if (totalQuestions >= 180 && data.details && Array.isArray(data.details)) {
                  // Calcular percentuais
                  const scorableQuestions = data.details.filter(d => !d.isPretest);
                  const totalScorableQuestions = scorableQuestions.length;
                  const overallPct = totalScorableQuestions > 0 ? Math.round((data.totalCorrect / totalScorableQuestions) * 100) : 0;
                  
                  // Performance por domínio
                  const domainStats = { 1: {correct:0, total:0}, 2: {correct:0, total:0}, 3: {correct:0, total:0} };
                  scorableQuestions.forEach(detail => {
                    const domainId = detail.domainId || detail.IdDominio;
                    if (domainStats[domainId]) {
                      domainStats[domainId].total++;
                      if (detail.isCorrect) domainStats[domainId].correct++;
                    }
                  });
                  
                  const peoplePct = domainStats[1].total > 0 ? Math.round((domainStats[1].correct / domainStats[1].total) * 100) : 0;
                  const processPct = domainStats[2].total > 0 ? Math.round((domainStats[2].correct / domainStats[2].total) * 100) : 0;
                  const businessPct = domainStats[3].total > 0 ? Math.round((domainStats[3].correct / domainStats[3].total) * 100) : 0;
                  
                  // Recuperar nome do usuário
                  const userName = localStorage.getItem('nome') || localStorage.getItem('userName') || localStorage.getItem('username') || 'Candidate';
                  
                  // Construir URL com parâmetros
                  const params = new URLSearchParams({
                    overallPct: overallPct,
                    peoplePct: peoplePct,
                    processPct: processPct,
                    businessPct: businessPct,
                    name: userName,
                    pmiId: '12345',
                    tcId: 'SIM-' + Date.now(),
                    date: new Date().toISOString().split('T')[0]
                  });
                  
                  // Limpar dados antes de redirecionar
                  try {
                    if (typeof window.clearExamDataShared === 'function') { window.clearExamDataShared(); }
                    else if (typeof clearExamData === 'function') { clearExamData(); }
                  } catch(_){}
                  
                  // Redirecionar para examPmiResults.html
                  (window.top || window).location.assign(`/pages/examPmiResults.html?${params.toString()}`);
                  return data;
                }
                
                // Após envio no modo quiz (exam.html), limpar dados e redirecionar para a página inicial
                try {
                  if (typeof window.clearExamDataShared === 'function') { window.clearExamDataShared(); }
                  else if (typeof clearExamData === 'function') { clearExamData(); }
                } catch(_){ }
                try { (window.top || window).location.assign('/'); } catch(_){ (window.top || window).location.href = '/'; }

                return data;
              } catch (err) {
                logger.error('submitExam error', err);
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
                  const qType = (q && typeof q.type === 'string') ? q.type.trim().toLowerCase() : '';

                  if (qType === 'match_columns') {
                    let resp = null;
                    try {
                      if (a && a.response && typeof a.response === 'object') resp = a.response;
                      else if (a && a.pairs && typeof a.pairs === 'object') resp = { pairs: a.pairs };
                    } catch(_){ resp = null; }
                    if (!resp) {
                      try {
                        const inst = (window.__mcInstances && window.__mcInstances[qKey]) ? window.__mcInstances[qKey] : null;
                        const v = inst && typeof inst.getValue === 'function' ? inst.getValue() : null;
                        const pairs = (v && v.pairs && typeof v.pairs === 'object') ? v.pairs : null;
                        if (pairs) resp = { pairs };
                      } catch(_){ }
                    }
                    if (questionId && resp) answers.push({ questionId, response: resp });
                    continue;
                  }
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
                // Ensure BACKEND_BASE has a proper default value
                const baseUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || 'http://localhost:3000';
                const submitUrl = baseUrl.replace(/\/$/, '') + '/api/exams/submit';
                const resp = await fetch(submitUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
                  body: JSON.stringify(payload),
                  credentials: 'include'
                });
                if (!resp.ok) throw new Error('partial submit failed: ' + resp.status);
                const data = await resp.json();
                return data;
              } catch (e) {
                logger.warn('submitPartial error', e);
                return { ok: false, error: String(e && e.message || e) };
              }
            }

            // expose submitExam globally so pages can trigger submission on finalize
            try { window.submitExam = submitExam; } catch(e) {}
            try { window.captureCurrentAnswerSnapshot = captureCurrentAnswerSnapshot; } catch(e) {}

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
                } catch(e){ logger.warn('auto partial submit failed', e); }
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

              // Botão: Conferir resposta
              (function initCheckAnswer(){
                const btn = document.getElementById('checkAnswerBtn');
                if (!btn) return;

                function bump(){
                  try {
                    btn.classList.remove('btn-bump');
                    // force reflow to restart animation
                    void btn.offsetWidth;
                    btn.classList.add('btn-bump');
                    setTimeout(()=>{ try{ btn.classList.remove('btn-bump'); } catch(_){ } }, 260);
                  } catch(_){ }
                }

                function clearFeedback(ac){
                  try {
                    const wraps = ac ? Array.from(ac.querySelectorAll('.option')) : [];
                    wraps.forEach(w => {
                      w.classList.remove('ans-correct','ans-wrong','reveal-correct');
                      const exp = w.querySelector('.opt-expl');
                      if (exp) exp.remove();
                    });
                  } catch(_){ }
                }

                function addExplanationToWrap(wrap, text){
                  try {
                    if (!wrap) return;
                    const exp = String(text || '').trim();
                    if (!exp) return;
                    const el = document.createElement('div');
                    el.className = 'opt-expl';
                    el.innerHTML = `<strong>Explicação:</strong> ${exp}`;
                    wrap.appendChild(el);
                  } catch(_){ }
                }

                async function handleClick(){
                  bump();
                  try {
                    const q = QUESTIONS[currentIdx];
                    if (!q || q.id == null) { try { showToast('Questão inválida.'); } catch(_){} return; }

                    const qKey = (q && (q.id !== undefined && q.id !== null)) ? `q_${q.id}` : `idx_${currentIdx}`;
                    const a = ANSWERS[qKey] || null;

                    const qType = (q && typeof q.type === 'string') ? q.type.trim().toLowerCase() : '';

                    const isMulti = (function(){
                      try {
                        if (q && typeof q.type === 'string') {
                          const t = q.type.toLowerCase();
                          if (t === 'checkbox' || t === 'multi' || t === 'multiple') return true;
                          if (t === 'radio' || t === 'single') return false;
                        }
                      } catch(_){ }
                      return !!(EXAM_BP && EXAM_BP.multiplaSelecao);
                    })();

                    const payload = { questionId: Number(q.id) };
                    if (qType === 'match_columns') {
                      const respObj = (a && a.response && typeof a.response === 'object') ? a.response : null;
                      if (respObj) payload.response = respObj;
                    } else if (isMulti) {
                      const ids = Array.isArray(a && a.optionIds) ? a.optionIds.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
                      if (ids.length) payload.optionIds = ids;
                    } else {
                      const id = (a && a.optionId != null && String(a.optionId).trim() !== '') ? Number(a.optionId) : null;
                      if (Number.isFinite(id) && id > 0) payload.optionId = id;
                    }

                    const baseUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || 'http://localhost:3000';
                    const url = baseUrl.replace(/\/$/, '') + '/api/exams/check-answer';

                    const token = (localStorage.getItem('sessionToken') || '').trim();
                    const jwtTok = (localStorage.getItem('jwt')||'').trim();
                    const jwtType = (localStorage.getItem('jwt_type')||'Bearer').trim() || 'Bearer';

                    const headers = { 'Content-Type': 'application/json' };
                    if (token) headers['X-Session-Token'] = token;
                    if (jwtTok) headers['Authorization'] = `${jwtType} ${jwtTok}`;

                    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' });
                    if (!resp.ok) {
                      const data = await resp.json().catch(()=>({}));
                      throw new Error(data && data.error ? data.error : ('Falha ao conferir resposta (' + resp.status + ')'));
                    }
                    const data = await resp.json();

                    if (qType === 'match_columns') {
                      try { MATCH_FEEDBACK[qKey] = data; } catch(_){ }
                      if (data && data.isCorrect === true) {
                        try { showToast('Acertou!', 1400); } catch(_){ }
                        try { renderQuestion(currentIdx); } catch(_){ }
                        return;
                      }

                      // Disregard the answer on wrong (mirrors legacy behavior)
                      try {
                        ANSWERS[qKey] = { disregarded: true };
                        saveAnswersForCurrentSession();
                      } catch(_){ }

                      // allow continue even if nothing selected (unless pause/checkpoint gate)
                      try {
                        const contBtn = $('continueBtn');
                        if (contBtn) {
                          const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                          const isCheckpoint = cps.includes(currentIdx);
                          const isExtraGate = (currentIdx === 59 || currentIdx === 119);
                          const allowOverride = isContinueOverrideEnabled();
                          const inPause = isPauseActive();
                          const gate = (isCheckpoint || isExtraGate) && !allowOverride;
                          contBtn.disabled = inPause || gate;
                        }
                      } catch(_){ }

                      try { showToast('Resposta desconsiderada.', 1600); } catch(_){ }
                      try { renderQuestion(currentIdx); } catch(_){ }
                      return;
                    }

                    const ac = document.getElementById('answersContainer');
                    if (!ac) return;
                    clearFeedback(ac);

                    const correctIds = Array.isArray(data && data.correctOptionIds) ? data.correctOptionIds.map(String) : [];
                    const explanations = (data && data.explanations && typeof data.explanations === 'object') ? data.explanations : {};

                    // mark correct option(s) and show explanations
                    const wraps = Array.from(ac.querySelectorAll('.option'));
                    wraps.forEach(wrap => {
                      const input = wrap.querySelector('input');
                      const oid = input && input.dataset ? String(input.dataset.optionId || '') : '';
                      if (!oid) return;

                      // explanation label under each option (if present)
                      const exp = explanations[oid];
                      if (exp) addExplanationToWrap(wrap, exp);

                      if (correctIds.includes(oid)) {
                        wrap.classList.add('ans-correct','reveal-correct');
                        // visually mark the correct option as checked (does not change stored ANSWERS)
                        try { if (input) input.checked = true; } catch(_){ }
                      }
                    });

                    if (data && data.isCorrect === true) {
                      try { showToast('Acertou!', 1400); } catch(_){ }
                      return;
                    }

                    // If user had marked wrong, disregard (clear stored answer)
                    try {
                      ANSWERS[qKey] = { disregarded: true };
                      saveAnswersForCurrentSession();
                    } catch(_){ }

                    // Also clear user selection in UI (wrong selections)
                    try {
                      const inputs = Array.from(ac.querySelectorAll('input'));
                      inputs.forEach(inp => {
                        const oid = inp && inp.dataset ? String(inp.dataset.optionId || '') : '';
                        if (!correctIds.includes(oid)) inp.checked = false;
                      });
                    } catch(_){ }

                    // allow continue even if nothing selected (unless pause/checkpoint gate)
                    try {
                      const contBtn = $('continueBtn');
                      if (contBtn) {
                        const cps = (EXAM_BP && EXAM_BP.pausas && Array.isArray(EXAM_BP.pausas.checkpoints)) ? EXAM_BP.pausas.checkpoints : [60,120];
                        const isCheckpoint = cps.includes(currentIdx);
                        const isExtraGate = (currentIdx === 59 || currentIdx === 119);
                        const allowOverride = isContinueOverrideEnabled();
                        const inPause = isPauseActive();
                        const gate = (isCheckpoint || isExtraGate) && !allowOverride;
                        contBtn.disabled = inPause || gate;
                      }
                    } catch(_){ }

                    try { showToast('Resposta desconsiderada.', 1600); } catch(_){ }
                  } catch (e) {
                    try { logger.warn('[exam] checkAnswer failed', e); } catch(_){ }
                    try { showToast(String(e && e.message ? e.message : 'Erro ao conferir resposta.'), 2000, true); } catch(_){ }
                  }
                }

                btn.addEventListener('click', handleClick);
              })();
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
                  logger.debug('[exam] prepareAndInit start');
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
                  logger.debug('[exam] QtdQuestoes=', window.QtdQuestoes, 'localStorage.examQuestionCount=', localStorage.getItem('examQuestionCount'));

                  // 1) Sempre tente usar o cache da sessão primeiro, independentemente de count
                  try {
                    if (window.currentSessionId) {
                      const qraw = localStorage.getItem(`questions_${window.currentSessionId}`);
                      if (qraw) {
                        try { QUESTIONS = JSON.parse(qraw); } catch(e) { QUESTIONS = []; }
                        // ensure options are normalized and frozen (loads from cache, no re-shuffle)
                        try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                        try { window.QUESTIONS = QUESTIONS; } catch(_){}
                        // rehydrate answers and progress for this cached set
                        try {
                          const raw = localStorage.getItem(`answers_${window.currentSessionId}`);
                          if (raw) {
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object') Object.keys(parsed).forEach(k => { ANSWERS[k] = parsed[k]; });
                          }
                        } catch(e) {}
                        // Normalize cached question shape and migrate any idx_* answers to q_<id> keys.
                        try { normalizeQuestionsAndMigrateAnswers(QUESTIONS); } catch(_){ }
                        try { saveAnswersForCurrentSession(); } catch(_){ }

                        // Hard requirement: every question must have an id. If cache is corrupted/legacy, refetch.
                        if (!allQuestionsHaveValidIds(QUESTIONS)) {
                          try {
                            localStorage.removeItem(`questions_${window.currentSessionId}`);
                          } catch(_){ }
                          try {
                            // keep answers, but remove progress so we don't jump to a bad index
                            localStorage.removeItem(`progress_${window.currentSessionId}`);
                          } catch(_){ }
                          QUESTIONS = [];
                          try { window.QUESTIONS = QUESTIONS; } catch(_){ }
                          // fall through to network fetch
                        } else {
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
                        // ensure answers are persisted (also captures any migrations)
                        try { saveAnswersForCurrentSession(); } catch(e){}
                        initExam();
                        return;
                        }
                      }
                    }
                  } catch(e) {}

                  // 2) Sem cache: se não houver count, caia para exemplo local
                  if (!count) {
                    // fallback to sample questions
                    QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                    try { window.QUESTIONS = QUESTIONS; } catch(_){}
                    // normalize and shuffle once (memoized for subsequent renders)
                    try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                    initExam();
                    return;
                  }

                  let token = localStorage.getItem('sessionToken') || '';
                  if (!token || token.endsWith('#')) {
                    const alt = localStorage.getItem('nomeUsuario') || localStorage.getItem('nome') || '';
                    if (alt) { try { localStorage.setItem('sessionToken', alt); } catch(e){} token = alt; }
                  }
                  logger.debug('[exam] using sessionToken=', token);
                  const fetchUrl = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE || '') + '/api/exams/select';
                  logger.debug('[exam] fetching questions from', fetchUrl, 'count=', count);
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

                  // Admin emulator: start exam with explicit question IDs (stored by examFull.html button)
                  try {
                    const rawIds = localStorage.getItem('examEmulatorQuestionIds');
                    if (rawIds) {
                      const parsed = JSON.parse(rawIds);
                      if (Array.isArray(parsed) && parsed.length) {
                        const ids = parsed.map(Number).filter(n => Number.isFinite(n) && n > 0).map(n => Math.floor(n));
                        // De-duplicate preserving order
                        const seen = new Set();
                        const uniq = [];
                        for (const id of ids) { if (!seen.has(id)) { seen.add(id); uniq.push(id); } }
                        if (uniq.length) {
                          payload.questionIds = uniq;
                          payload.count = uniq.length;
                          try { localStorage.setItem('examQuestionCount', String(uniq.length)); } catch(_){ }
                          // Hint mode to backend (optional)
                          try { payload._emulator = true; } catch(_){ }
                        }
                      }
                    }
                  } catch(_){ }
                  const bypassFilters = !!(payload && payload.questionIds) || (Number(count) === 180);
                  if (!bypassFilters) {
                    if (areas && areas.length) payload.areas = areas;
                    if (grupos && grupos.length) payload.grupos = grupos;
                    if (dominios && dominios.length) payload.dominios = dominios;
                  }
                  // Ensure CSRF token is ready before POSTing
                  try { if (window.csrfManager && typeof window.csrfManager.getToken === 'function') { await window.csrfManager.getToken(); } } catch(_) {}
                  const resp = await fetch(fetchUrl, {
                    method: 'POST',
                    headers: (() => {
                      const h = { 'Content-Type': 'application/json', 'X-Session-Token': token, 'X-Exam-Type': examType };
                      try {
                        const jwtTok = (localStorage.getItem('jwt')||'').trim();
                        const jwtType = (localStorage.getItem('jwt_type')||'Bearer').trim();
                        if (jwtTok) h['Authorization'] = `${jwtType} ${jwtTok}`;
                      } catch(_){ }
                      // Explicitly include CSRF header (wrapper also injects it)
                      try {
                        const csrfTok = (window.csrfManager && window.csrfManager.token) ? String(window.csrfManager.token) : null;
                        if (csrfTok) h['X-CSRF-Token'] = csrfTok;
                      } catch(_){ }
                      return h;
                    })(),
                    body: JSON.stringify(payload),
                    credentials: 'include'
                  });
                  if (!resp.ok) {
                    let available = null;
                    try {
                      const t = await resp.text();
                      try { const j = t ? JSON.parse(t) : null; if (j && typeof j.available === 'number') available = j.available; } catch(_){}
                    } catch(_){}
                    // Friendly handling when backend indicates not enough available
                    try { logger.warn('[exam] select failed', { status: resp.status, available, url: fetchUrl }); } catch(_){ }
                    if (resp.status === 400 && typeof available === 'number') {
                      // Special fallback: if full exam requested (180) and available=0, retry ignoring exam_type constraint
                      if (bypassFilters && available === 0) {
                        try {
                          // Ensure CSRF token is ready before fallback POST
                          try { if (window.csrfManager && typeof window.csrfManager.getToken === 'function') { await window.csrfManager.getToken(); } } catch(_) {}
                          const resp2 = await fetch(fetchUrl, {
                            method: 'POST',
                            headers: (() => { const h = { 'Content-Type': 'application/json', 'X-Session-Token': token }; try { const jwtTok = (localStorage.getItem('jwt')||'').trim(); const jwtType = (localStorage.getItem('jwt_type')||'Bearer').trim(); if (jwtTok) h['Authorization'] = `${jwtType} ${jwtTok}`; } catch(_){} return h; })(),
                            body: JSON.stringify({ count, ignoreExamType: true }),
                            credentials: 'include'
                          });
                          if (resp2.ok) {
                            const data2 = await resp2.json();
                            // mimic normal success path by setting data and proceeding
                            const data = data2;
                            logger.debug('[exam] fetched data (fallback ignoreExamType)', data && { total: data.total, questions: (data.questions||[]).length });
                            try { if (data && Array.isArray(data.questions) && data.questions.length) { logger.debug('[exam] sample question[0] raw (fallback)', data.questions[0]); } } catch(e){}
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
                            } catch(e) { logger.warn('failed to persist blueprint', e); }
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
                                id: (q && (q.id != null ? q.id : (q.Id != null ? q.Id : null))),
                                type: (q && (q.type || q.tiposlug || q.tipoSlug)) || null,
                                // Keep interaction spec (e.g., match_columns)
                                interacao: (q.interacao || q.interaction || null),
                                interacaospec: (q.interacaospec || null),
                                // Keep pretest marker if present
                                _isPreTest: (q._isPreTest === true || q.isPreTest === true),
                                descricao: q.descricao,
                                explicacao: q.explicacao,
                                idprocesso: q.idprocesso,
                                text: q.descricao,
                                // Preserve image fields so UI can render below the question text
                                imagem_url: (q.imagem_url || q.imagemUrl || q.image_url || q.imageUrl || null),
                                imagemUrl: (q.imagemUrl || q.imagem_url || q.image_url || q.imageUrl || null),
                                options: (q.options || []).map(o => ({ id: o.id || o.Id || null, text: (o.text || o.descricao || o.Descricao || '') }))
                              }));
                              try { normalizeQuestionsAndMigrateAnswers(QUESTIONS); } catch(_){ }
                              try { saveAnswersForCurrentSession(); } catch(_){ }
                              if (!allQuestionsHaveValidIds(QUESTIONS)) {
                                throw new Error('Questões recebidas sem id. Atualize a página e tente novamente.');
                              }
                              try { updatePretestWarning(data, QUESTIONS); } catch(_){ }
                              try {
                                const withImg = QUESTIONS.filter(q => q.imagem_url || q.imagemUrl);
                                if (withImg.length) {
                                  logger.debug('[exam] (fallback) questions with image count', withImg.length);
                                  const q266 = withImg.find(q => q.id === 266);
                                  if (q266) {
                                    const rawImg = q266.imagem_url || q266.imagemUrl;
                                    logger.debug('[exam] (fallback) q266 image len', rawImg ? rawImg.length : 0, 'startsWith(data:)?', /^data:/i.test(rawImg), 'prefix50', rawImg ? rawImg.slice(0,50) : null);
                                  }
                                } else {
                                  logger.debug('[exam] (fallback) no questions have imagem_url/imagemUrl');
                                }
                              } catch(e) {}
                              try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                              try { window.QUESTIONS = QUESTIONS; } catch(_){}
                              try {
                                if (window.currentSessionId) {
                                  const qkey = `questions_${window.currentSessionId}`;
                                  const existingRaw = localStorage.getItem(qkey);
                                  if (existingRaw) {
                                    // Merge image/explanation fields if newly available
                                    try {
                                      const prev = JSON.parse(existingRaw);
                                      if (Array.isArray(prev)) {
                                        const byId = new Map(prev.map(p => [p.id, p]));
                                        let changed = false;
                                        for (const nq of QUESTIONS) {
                                          const old = byId.get(nq.id);
                                          if (old) {
                                            if (!old.imagem_url && nq.imagem_url) { old.imagem_url = nq.imagem_url; changed = true; }
                                            if (!old.imagemUrl && nq.imagemUrl) { old.imagemUrl = nq.imagemUrl; changed = true; }
                                            if (!old.explicacao && nq.explicacao) { old.explicacao = nq.explicacao; changed = true; }
                                          }
                                        }
                                        if (changed) {
                                          const merged = prev.map(p => byId.get(p.id) || p);
                                          localStorage.setItem(qkey, JSON.stringify(merged));
                                          localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
                                          QUESTIONS = merged; // reflect merged set in memory
                                        }
                                      }
                                    } catch(_){}
                                  } else {
                                    localStorage.setItem(qkey, JSON.stringify(QUESTIONS));
                                    localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
                                  }
                                }
                              } catch(e){}
                            } else {
                              QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                              try { window.QUESTIONS = QUESTIONS; } catch(_){}
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
                            const safeMsg = `Não há questões suficientes para sua seleção. Disponíveis: <strong>${Number(available)}</strong>. Você pode iniciar com <strong>${Number(suggested)}</strong>. ` +
                              `<button id="${btnId}" style="margin-left:6px;background:#eef3ff;color:#2b6cb0;border:1px solid #c6d3ff;border-radius:6px;padding:4px 8px;cursor:pointer">Ajustar para ${Number(suggested)}</button>`;
                            statusEl.innerHTML = sanitizeHTML(safeMsg);
                            const btn = document.getElementById(btnId);
                            if (btn) btn.onclick = async () => {
                              try { localStorage.setItem('examQuestionCount', String(suggested)); } catch(e){}
                              statusEl.textContent = 'Ajustando e carregando questões...';
                              await prepareAndInit();
                            };
                          } else {
                            // available === 0
                            const backId = 'backToSetupBtn';
                            const safeMsg = `Nenhuma questão encontrada para os filtros selecionados. ` +
                              `<button id="${backId}" style="margin-left:6px;background:#eef3ff;color:#2b6cb0;border:1px solid #c6d3ff;border-radius:6px;padding:4px 8px;cursor:pointer">Voltar à configuração</button>`;
                            statusEl.innerHTML = sanitizeHTML(safeMsg);
                            const b = document.getElementById(backId);
                            if (b) b.onclick = () => { try { (window.top || window).location.assign('/pages/examSetup.html'); } catch(_){} };
                          }
                        }
                      } catch(_){}
                      return; // stop here, do not initialize fallback questions
                    }
                    logger.warn('Failed to fetch questions', resp.status);
                    // fallback to sample questions so the UI remains usable in other error cases
                    QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                    initExam();
                    return;
                  }

                  // Clear emulator IDs after a successful selection to avoid surprising future starts.
                  try { if (payload && payload.questionIds) localStorage.removeItem('examEmulatorQuestionIds'); } catch(_){ }
                  const data = await resp.json();
                  logger.debug('[exam] fetched data', data && { total: data.total, questions: (data.questions||[]).length });
                  try { if (data && Array.isArray(data.questions) && data.questions.length) { logger.debug('[exam] sample question[0] raw', data.questions[0]); } } catch(e){}
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
                    // Debug: log questão 266 antes do mapeamento
                    try {
                      const preQ266 = data.questions.find(q => q && q.id === 266);
                      if (preQ266) logger.debug('[exam] pre-map q266 raw', { id: preQ266.id, imagem_url: preQ266.imagem_url, imagemUrl: preQ266.imagemUrl, len_imagem_url: preQ266.imagem_url ? String(preQ266.imagem_url).length : 0 });
                      else logger.debug('[exam] pre-map q266 not found in response');
                    } catch(_){}
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
                    } catch(e) { logger.warn('failed to persist blueprint', e); }
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
                      id: (q && (q.id != null ? q.id : (q.Id != null ? q.Id : null))),
                      type: (q && (q.type || q.tiposlug || q.tipoSlug)) || null,
                      // Keep interaction spec (e.g., match_columns)
                      interacao: (q.interacao || q.interaction || null),
                      interacaospec: (q.interacaospec || null),
                      // Keep pretest marker if present
                      _isPreTest: (q._isPreTest === true || q.isPreTest === true),
                      descricao: q.descricao,
                      explicacao: q.explicacao,
                      idprocesso: q.idprocesso,
                      text: q.descricao,
                      // Preserve image fields so UI can render below the question text
                      imagem_url: (q.imagem_url || q.imagemUrl || q.image_url || q.imageUrl || null),
                      imagemUrl: (q.imagemUrl || q.imagem_url || q.image_url || q.imageUrl || null),
                      options: (q.options || []).map(o => ({ id: o.id || o.Id || null, text: (o.text || o.descricao || o.Descricao || '') }))
                    }));
                    try { normalizeQuestionsAndMigrateAnswers(QUESTIONS); } catch(_){ }
                    try { saveAnswersForCurrentSession(); } catch(_){ }
                    if (!allQuestionsHaveValidIds(QUESTIONS)) {
                      throw new Error('Questões recebidas sem id. Atualize a página e tente novamente.');
                    }
                    try { updatePretestWarning(data, QUESTIONS); } catch(_){ }
                    try { window.QUESTIONS = QUESTIONS; } catch(_){}
                    // Debug: log questão 266 após mapeamento
                    try {
                      const postQ266 = QUESTIONS.find(q => q && q.id === 266);
                      if (postQ266) logger.debug('[exam] post-map q266', { id: postQ266.id, imagem_url: postQ266.imagem_url, imagemUrl: postQ266.imagemUrl, len_imagem_url: postQ266.imagem_url ? String(postQ266.imagem_url).length : 0 });
                      else logger.debug('[exam] post-map q266 not found');
                    } catch(_){}
                    // ensure each question has a single shuffledOptions array (frozen order)
                    try { ensureShuffledOptionsForAll(QUESTIONS); } catch(e){}
                    // persist the questions for this session so reloads don't change them
                    try {
                      if (window.currentSessionId) {
                        const qkey = `questions_${window.currentSessionId}`;
                        const existingRaw = localStorage.getItem(qkey);
                        if (existingRaw) {
                          try {
                            const prev = JSON.parse(existingRaw);
                            if (Array.isArray(prev)) {
                              const byId = new Map(prev.map(p => [p.id, p]));
                              let changed = false;
                              for (const nq of QUESTIONS) {
                                const old = byId.get(nq.id);
                                if (old) {
                                  if (!old.imagem_url && nq.imagem_url) { old.imagem_url = nq.imagem_url; changed = true; }
                                  if (!old.imagemUrl && nq.imagemUrl) { old.imagemUrl = nq.imagemUrl; changed = true; }
                                  if (!old.explicacao && nq.explicacao) { old.explicacao = nq.explicacao; changed = true; }
                                }
                              }
                              if (changed) {
                                const merged = prev.map(p => byId.get(p.id) || p);
                                localStorage.setItem(qkey, JSON.stringify(merged));
                                localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
                                QUESTIONS = merged;
                                try {
                                  const mergeQ266 = QUESTIONS.find(q => q && q.id === 266);
                                  if (mergeQ266) logger.debug('[exam] merged q266', { id: mergeQ266.id, imagem_url: mergeQ266.imagem_url, imagemUrl: mergeQ266.imagemUrl, len_imagem_url: mergeQ266.imagem_url ? String(mergeQ266.imagem_url).length : 0 });
                                } catch(_){}
                              }
                            }
                          } catch(_){}
                        } else {
                          localStorage.setItem(qkey, JSON.stringify(QUESTIONS));
                          localStorage.setItem(`${qkey}_savedAt`, new Date().toISOString());
                          try {
                            const storeQ266 = QUESTIONS.find(q => q && q.id === 266);
                            if (storeQ266) logger.debug('[exam] stored q266', { id: storeQ266.id, imagem_url: storeQ266.imagem_url, imagemUrl: storeQ266.imagemUrl, len_imagem_url: storeQ266.imagem_url ? String(storeQ266.imagem_url).length : 0 });
                          } catch(_){}
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
                    // Disparar evento para permitir que examFull re-renderize imagem imediatamente
                    try { document.dispatchEvent(new CustomEvent('exam:question-index-changed', { detail: { index: currentIdx } })); } catch(_){ }
                  } else {
                    // no questions returned - fallback
                    QUESTIONS = [ { text: generateFixedLengthText(200), options: ['Opção A','Opção B','Opção C','Opção D'] } ];
                    try { window.QUESTIONS = QUESTIONS; } catch(_){}
                  }
                } catch (e) {
                  logger.warn('prepareAndInit error', e);
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
          
