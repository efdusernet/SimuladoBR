const db = require('../models');
const sequelize = require('../config/database');
// Daily user exam attempt stats service
const userStatsService = require('../services/UserStatsService')(db);
const { User } = db;
// lightweight session id generator (no external dependency)
function genSessionId(){
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
}

// In-memory exam sessions (prototype only). Consider using Redis/DB in production.
const SESSIONS = new Map();
function putSession(sessionId, data, ttlMs = 6 * 60 * 60 * 1000) { // 6h TTL default
  const expiresAt = Date.now() + ttlMs;
  SESSIONS.set(sessionId, { ...data, expiresAt });
}
function getSession(sessionId) {
  const s = SESSIONS.get(sessionId);
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) { SESSIONS.delete(sessionId); return null; }
  return s;
}
function updateSession(sessionId, patch) {
  const s = getSession(sessionId);
  if (!s) return null;
  const ns = { ...s, ...patch };
  SESSIONS.set(sessionId, ns);
  return ns;
}

// DB-backed exam types cache (5 min TTL)
let _examTypesCache = { data: null, expiresAt: 0 };
async function loadExamTypesFromDb() {
  try {
    if (Date.now() < _examTypesCache.expiresAt && Array.isArray(_examTypesCache.data)) return _examTypesCache.data;
    if (!db.ExamType) return null;
    const rows = await db.ExamType.findAll({ where: { Ativo: true }, order: [['Nome', 'ASC']] });
    const types = rows.map(r => ({
      id: r.Slug,
      nome: r.Nome,
      numeroQuestoes: r.NumeroQuestoes,
      duracaoMinutos: r.DuracaoMinutos,
      opcoesPorQuestao: r.OpcoesPorQuestao,
      multiplaSelecao: !!r.MultiplaSelecao,
      pontuacaoMinima: r.PontuacaoMinimaPercent == null ? null : Number(r.PontuacaoMinimaPercent),
      pausas: {
        permitido: !!r.PausaPermitida,
        checkpoints: Array.isArray(r.PausaCheckpoints) ? r.PausaCheckpoints : [],
        duracaoMinutosPorPausa: r.PausaDuracaoMinutos || 0,
      },
      _dbId: r.Id,
    }));
    _examTypesCache = { data: types, expiresAt: Date.now() + 5 * 60 * 1000 };
    return types;
  } catch (_) { return null; }
}
async function getExamTypeBySlugOrDefault(slug) {
  const registry = require('../services/exams/ExamRegistry');
  const types = await loadExamTypesFromDb();
  if (types && types.length) return types.find(t => t.id === slug) || types[0];
  const reg = registry.getTypeById(slug);
  return reg ? { ...reg, _dbId: null } : null;
}

// Read FULL_EXAM_QUESTION_COUNT from env with a safe default
function getFullExamQuestionCount() {
  const v = Number(process.env.FULL_EXAM_QUESTION_COUNT);
  return Number.isFinite(v) && v > 0 ? v : 180;
}

exports.listExams = async (req, res) => {
  try {
    const types = await loadExamTypesFromDb();
    if (types && types.length) return res.json(types);
    const disableFallback = String(process.env.EXAM_TYPES_DISABLE_FALLBACK || '').toLowerCase() === 'true';
    if (disableFallback) {
      return res.status(404).json({ error: 'No exam types configured in DB' });
    }
    const registry = require('../services/exams/ExamRegistry');
    return res.json(registry.getTypes());
  } catch (err) {
    console.error('Erro listExams:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// GET /api/exams/types -> returns configured exam types (for UI)
exports.listExamTypes = async (_req, res) => {
  try {
    const types = await loadExamTypesFromDb();
    if (types && types.length) return res.json(types);
    const disableFallback = String(process.env.EXAM_TYPES_DISABLE_FALLBACK || '').toLowerCase() === 'true';
    if (disableFallback) {
      return res.status(404).json({ error: 'No exam types configured in DB' });
    }
    const registry = require('../services/exams/ExamRegistry');
    return res.json(registry.getTypes());
  } catch (err) {
    console.error('Erro listExamTypes:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// POST /api/exams/select
// Body: { count: number, dominios?: [ids], areas?: [ids], grupos?: [ids] }
// Used by: frontend/pages/examSetup.html (para contar/selecionar) e wrappers em exam.html/examFull.html
exports.selectQuestions = async (req, res) => {
  try {
  const examType = (req.body && req.body.examType) || (req.get('X-Exam-Type') || '').trim() || 'pmp';
  // Resolve exam mode from header or infer by count (quiz/full). Header wins if valid.
  let headerMode = (req.get('X-Exam-Mode') || '').trim().toLowerCase();
  if (!(headerMode === 'quiz' || headerMode === 'full')) headerMode = null;
  const examCfg = await getExamTypeBySlugOrDefault(examType);
  let count = Number((req.body && req.body.count) || 0) || 0;
    if (!count || count <= 0) return res.status(400).json({ error: 'count required' });
    // Infer mode when header not provided: full when count >= examCfg.numeroQuestoes (or env-configured), quiz when count < full threshold
    let examMode = headerMode;
    try {
      if (!examMode) {
        const fullThreshold = (examCfg && Number(examCfg.numeroQuestoes)) ? Number(examCfg.numeroQuestoes) : getFullExamQuestionCount();
        if (count >= fullThreshold) examMode = 'full';
        else if (count > 0 && count < fullThreshold) examMode = 'quiz';
      }
    } catch(_) { /* keep null if inference fails */ }

    // resolve user via X-Session-Token (same logic as /api/auth/me)
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(sessionToken)) {
      user = await User.findByPk(Number(sessionToken));
    }
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bloqueio = Boolean(user.BloqueioAtivado);
    // Enforce hard cap for blocked users
    if (bloqueio && count > 25) {
      count = 25;
    }

  // Optional filters
  const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;
  const areas = Array.isArray(req.body.areas) && req.body.areas.length ? req.body.areas.map(Number) : null;
  const grupos = Array.isArray(req.body.grupos) && req.body.grupos.length ? req.body.grupos.map(Number) : null;
  const categorias = Array.isArray(req.body.categorias) && req.body.categorias.length ? req.body.categorias.map(Number) : null;
  // Flag premium: somente questões inéditas
  const onlyNew = (!bloqueio) && (req.body.onlyNew === true || req.body.onlyNew === 'true');
  const hasFilters = Boolean((dominios && dominios.length) || (areas && areas.length) || (grupos && grupos.length) || (categorias && categorias.length));

  // Build WHERE clause
  // Prefix with q. to avoid ambiguity when joining tables that also have 'excluido'
  const whereClauses = [`q.excluido = false`, `q.idstatus = 1`];
  // Optional exam version filter from environment (EXAM_VER)
  const examVersion = (process.env.EXAM_VER || '').trim();
  if (examVersion) {
    // Use parameter binding to avoid injection; will add to replacements later
    whereClauses.push(`q.versao_exame = :examVersion`);
  }
  // Filter by exam type linkage if available in DB (1:N)
  if (examCfg && examCfg._dbId) {
    whereClauses.push(`q.exam_type_id = ${Number(examCfg._dbId)}`);
  }
  if (bloqueio) whereClauses.push(`q.seed = true`);
  // AND semantics across tabs; OR within each list
  // i.e., if user chose dominios AND grupos, a question must match both a selected domínio AND a selected grupo
  if (dominios && dominios.length) whereClauses.push(`q.iddominio IN (${dominios.join(',')})`);
  if (areas && areas.length) whereClauses.push(`q.codareaconhecimento IN (${areas.join(',')})`);
  if (grupos && grupos.length) whereClauses.push(`q.codgrupoprocesso IN (${grupos.join(',')})`);
  if (categorias && categorias.length) whereClauses.push(`q.codigocategoria IN (${categorias.join(',')})`);
  // Excluir questões já respondidas se onlyNew ativo (premium)
  if (onlyNew) {
    try {
      const answeredSql = `SELECT DISTINCT aq.question_id AS qid
        FROM exam_attempt_answer aa
        JOIN exam_attempt_question aq ON aq.id = aa.attempt_question_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE a.user_id = :uid ${examCfg && examCfg._dbId ? 'AND a.exam_type_id = :etype' : ''}`;
      const answeredRows = await sequelize.query(answeredSql, { replacements: { uid: user.Id || user.id, etype: examCfg ? examCfg._dbId : null }, type: sequelize.QueryTypes.SELECT });
      const answeredIds = (answeredRows || []).map(r => Number(r.qid)).filter(n => Number.isFinite(n));
      if (answeredIds.length) {
        const limited = answeredIds.slice(0, 10000); // limite defensivo
        whereClauses.push(`q.id NOT IN (${limited.join(',')})`);
      }
    } catch(e) { /* ignore */ }
  }
  const whereSql = whereClauses.join(' AND ');

    // Count available (with exam_type when applicable)
  const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao q WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { replacements: examVersion ? { examVersion } : {}, type: sequelize.QueryTypes.SELECT });
    let available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;

    // Always respect exam type; no fallback that drops exam_type
    const whereSqlUsed = whereSql;

    // Support preflight count-only check
    const onlyCount = Boolean(req.body && req.body.onlyCount) || String(req.query && req.query.onlyCount).toLowerCase() === 'true';
    if (onlyCount) {
      const wantDebugSql = String(req.get('X-Debug-SQL') || '').toLowerCase() === 'true';
      const out = { available };
      if (wantDebugSql) {
        out.where = whereSqlUsed;
        out.query = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSqlUsed}`;
        out.filters = { dominios, areas, grupos, categorias, bloqueio, examType };
      }
      return res.json(out);
    }

    if (available < 1) {
      return res.status(400).json({ error: 'Not enough questions available', available });
    }
    // New selection path for full exam mode (distribution + pretest) else legacy random selection
    let payloadQuestions = [];
    let ids = [];
    const FULL_TOTAL = count; // requested total (e.g. 180)
    const PRETEST_COUNT_TARGET = (examMode === 'full') ? 5 : 0; // fixed 5 for full exam
    const REGULAR_TARGET = Math.max(FULL_TOTAL - PRETEST_COUNT_TARGET, 0);

    const baseQuestionSelect = (extraWhere, limit) => {
      const replacements = { limit };
      if (examVersion) replacements.examVersion = examVersion;
      return sequelize.query(`SELECT q.id, q.descricao, q.tiposlug AS tiposlug, q.multiplaescolha AS multiplaescolha, q.imagem_url AS imagem_url, q.imagem_url AS "imagemUrl", eg.descricao AS explicacao
        FROM questao q
        LEFT JOIN explicacaoguia eg ON eg.idquestao = q.id AND (eg.excluido = false OR eg.excluido IS NULL)
        WHERE ${whereSqlUsed} ${extraWhere ? ' AND ' + extraWhere : ''}
        ORDER BY random()
        LIMIT :limit`, { replacements, type: sequelize.QueryTypes.SELECT });
    };

    if (examMode === 'full') {
      // 1) Pretest questions (is_pretest = true)
      const pretestRows = await baseQuestionSelect(`is_pretest = TRUE`, PRETEST_COUNT_TARGET);
      const actualPretestCount = pretestRows.length;

      // 2) Regular distributed questions via ECO table (iddominiogeral share)
      // Load ECO shares (id_dominio, share). Assume table eco with columns id_dominio (int) and share (numeric/percent)
      let ecoShares = [];
      try {
        ecoShares = await sequelize.query(`SELECT id_dominio, share FROM eco`, { type: sequelize.QueryTypes.SELECT });
      } catch (e) { ecoShares = []; }

      // Compute allocations
      let allocations = [];
      if (ecoShares.length) {
        const sumShare = ecoShares.reduce((s, r) => s + Number(r.share || 0), 0);
        // Determine divisor: if sum looks like percentage (around 100) use 100; else use sumShare as weight total.
        const divisor = (sumShare > 99 && sumShare < 101) ? 100 : (sumShare > 0 ? sumShare : 1);
        // Preliminary allocation with fractional tracking
        const prelim = ecoShares.map(r => {
          const rawAlloc = (Number(r.share || 0) / divisor) * REGULAR_TARGET;
          return { id_dominio: r.id_dominio, share: Number(r.share || 0), raw: rawAlloc, floor: Math.floor(rawAlloc), frac: rawAlloc - Math.floor(rawAlloc) };
        });
        let allocated = prelim.reduce((s, r) => s + r.floor, 0);
        let remainder = REGULAR_TARGET - allocated;
        // Distribute remainder by largest fractional part
        prelim.sort((a, b) => b.frac - a.frac);
        for (let i = 0; i < prelim.length && remainder > 0; i++, remainder--) prelim[i].floor++;
        allocations = prelim.map(r => ({ id_dominio: r.id_dominio, count: r.floor })).filter(a => a.count > 0);
      }

      // Fallback: if no ecoShares, select all remaining without distribution
      if (!allocations.length) allocations = [{ id_dominio: null, count: REGULAR_TARGET }];

      // Query per domain respecting availability and excluding pretest ids
      let regularRows = [];
      const excludeIds = new Set(pretestRows.map(r => r.id));
      for (const alloc of allocations) {
        if (alloc.count <= 0) continue;
        const domWhere = alloc.id_dominio != null ? `iddominiogeral = ${Number(alloc.id_dominio)}` : null;
        const extraWhereParts = [`is_pretest = FALSE`];
        if (domWhere) extraWhereParts.push(domWhere);
        if (excludeIds.size) extraWhereParts.push(`id NOT IN (${Array.from(excludeIds).join(',')})`);
        const extraWhere = extraWhereParts.join(' AND ');
        const rows = await baseQuestionSelect(extraWhere, alloc.count);
        rows.forEach(r => { regularRows.push(r); excludeIds.add(r.id); });
      }

      // Top-up if shortage
      const currentRegularCount = regularRows.length;
      if (currentRegularCount < REGULAR_TARGET) {
        const needed = REGULAR_TARGET - currentRegularCount;
        const topUpWhereParts = [`is_pretest = FALSE`];
        if (excludeIds.size) topUpWhereParts.push(`id NOT IN (${Array.from(excludeIds).join(',')})`);
        const topUpWhere = topUpWhereParts.join(' AND ');
        const topRows = await baseQuestionSelect(topUpWhere, needed);
        topRows.forEach(r => { regularRows.push(r); excludeIds.add(r.id); });
      }

      // Combine, then fetch options once for all selected IDs
      const combined = [...pretestRows.map(r => ({ ...r, _isPreTest: true })), ...regularRows.map(r => ({ ...r, _isPreTest: false }))];
      // Debug: log imagem_url presence for question 266 before shuffling
      try {
        const dbgQ266 = combined.find(q => q && Number(q.id) === 266);
        if (dbgQ266) {
          console.debug('[selectQuestions] pre-shuffle Q266 imagem_url raw length=', dbgQ266.imagem_url ? String(dbgQ266.imagem_url).length : 0, 'startsWith(data:)', /^data:/i.test(String(dbgQ266.imagem_url||'')), 'prefix50=', dbgQ266.imagem_url ? String(dbgQ266.imagem_url).slice(0,50) : null);
        } else {
          console.debug('[selectQuestions] Q266 not found in combined set (full mode)');
        }
      } catch(_) {}
      // Shuffle order
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }
      const allIds = combined.map(q => q.id).filter(n => Number.isFinite(n));
      let rawOptions = [];
      if (allIds.length) {
        try {
          const optsQ = `SELECT id, idquestao, descricao
            FROM respostaopcao
            WHERE (excluido = FALSE OR excluido IS NULL) AND idquestao IN (:ids)
            ORDER BY idquestao, id`;
          rawOptions = await sequelize.query(optsQ, { replacements: { ids: allIds }, type: sequelize.QueryTypes.SELECT });
        } catch(_) { rawOptions = []; }
      }
      const optsByQ = {};
      rawOptions.forEach(o => {
        const qid = Number(o.idquestao || o.IdQuestao);
        if (!Number.isFinite(qid)) return;
        if (!optsByQ[qid]) optsByQ[qid] = [];
        optsByQ[qid].push({ id: o.id || o.Id, descricao: o.descricao || o.Descricao });
      });
      payloadQuestions = combined.map(q => {
        const slug = (q.tiposlug || '').toString().toLowerCase();
        let type = null;
        if (slug) {
          if (slug === 'multi' || slug === 'multiple' || slug === 'checkbox') type = 'checkbox';
          else if (slug === 'single' || slug === 'radio') type = 'radio';
          else type = slug;
        } else {
          type = (q.multiplaescolha === true || q.multiplaescolha === 't') ? 'checkbox' : 'radio';
        }
        return { id: q.id, descricao: q.descricao, explicacao: q.explicacao, imagem_url: q.imagem_url || null, imagemUrl: q.imagem_url || q.imagemUrl || null, type, options: optsByQ[q.id] || [], _isPreTest: q._isPreTest };
      });
      // Debug: after initial mapping, log q266 again
      try {
        const mappedQ266 = payloadQuestions.find(q => q && Number(q.id) === 266);
        if (mappedQ266) console.debug('[selectQuestions] mapped Q266 imagem_url length=', mappedQ266.imagem_url ? String(mappedQ266.imagem_url).length : 0);
      } catch(_) {}
      ids = allIds;
    } else {
      // Legacy path (quiz or non-full)
      const limitUsed = Math.min(count, available);
      const questions = await baseQuestionSelect(null, limitUsed);
      ids = questions.map(q => q.id);
      // Fetch options
      let options = [];
      if (ids.length) {
        const optsQ = `SELECT id, idquestao, descricao, iscorreta
          FROM respostaopcao
          WHERE (excluido = false OR excluido IS NULL) AND idquestao IN (:ids)
          ORDER BY random()`;
        options = await sequelize.query(optsQ, { replacements: { ids }, type: sequelize.QueryTypes.SELECT });
      }
      const optsByQ = {};
      options.forEach(o => {
        const qid = o.idquestao || o.IdQuestao;
        if (!optsByQ[qid]) optsByQ[qid] = [];
        optsByQ[qid].push({ id: o.id || o.Id, descricao: o.descricao || o.Descricao });
      });
      payloadQuestions = questions.map(q => {
        const slug = (q.tiposlug || '').toString().toLowerCase();
        let type = null;
        if (slug) {
          if (slug === 'multi' || slug === 'multiple' || slug === 'checkbox') type = 'checkbox';
          else if (slug === 'single' || slug === 'radio') type = 'radio';
          else type = slug;
        } else {
          type = (q.multiplaescolha === true || q.multiplaescolha === 't') ? 'checkbox' : 'radio';
        }
        return { id: q.id, descricao: q.descricao, explicacao: q.explicacao, imagem_url: q.imagem_url || null, imagemUrl: q.imagem_url || q.imagemUrl || null, type, options: optsByQ[q.id] || [] };
      });
      try {
        const mappedQ266 = payloadQuestions.find(q => q && Number(q.id) === 266);
        if (mappedQ266) console.debug('[selectQuestions] (legacy) mapped Q266 imagem_url length=', mappedQ266.imagem_url ? String(mappedQ266.imagem_url).length : 0);
      } catch(_) {}
    }

    // generate session id and persist attempt with ordered questions
  const sessionId = genSessionId();

    // initialize pause state based on policy
    const policy = examCfg.pausas || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    const pauseState = { pauseUntil: 0, consumed: {} };
    (policy.checkpoints || []).forEach((cp) => { pauseState.consumed[cp] = false; });

    // Persist attempt and ordered questions mirroring start-on-demand
    let attempt = null;
    try {
      await db.sequelize.transaction(async (t) => {
        attempt = await db.ExamAttempt.create({
          UserId: user.Id || user.id,
          ExamTypeId: examCfg._dbId || null,
          Modo: 'select',
          QuantidadeQuestoes: payloadQuestions.length,
          ExamMode: examMode || null,
          StartedAt: new Date(),
          LastActivityAt: new Date(),
          Status: 'in_progress',
          PauseState: pauseState,
          Meta: { sessionId, source: 'select', examType: examCfg.id, examMode: examMode || null },
          BlueprintSnapshot: {
            id: examCfg.id,
            nome: examCfg.nome,
            numeroQuestoes: examCfg.numeroQuestoes,
            duracaoMinutos: examCfg.duracaoMinutos,
            pausas: policy,
            opcoesPorQuestao: examCfg.opcoesPorQuestao,
            multiplaSelecao: examCfg.multiplaSelecao,
            pontuacaoMinima: examCfg.pontuacaoMinima ?? null,
          },
          FiltrosUsados: { dominios, areas, grupos, onlyNew: !!onlyNew, fallbackIgnoreExamType: false },
        }, { transaction: t });
        if (attempt && payloadQuestions.length) {
          const rows = payloadQuestions.map((q, idx) => ({ AttemptId: attempt.Id, QuestionId: q.id, Ordem: idx + 1, IsPreTest: q._isPreTest === true }));
          await db.ExamAttemptQuestion.bulkCreate(rows, { transaction: t });
        }
      });
      // Stats: increment started count
      try { if (attempt && attempt.Id) await userStatsService.incrementStarted(attempt.UserId || (user && (user.Id || user.id))); } catch(_) {}
    } catch (e) {
      console.warn('selectQuestions: could not persist attempt', e);
    }

    // Keep session state in memory to support later submit and pause
    try {
      putSession(sessionId, {
        userId: user.Id || user.id,
        examType: examCfg.id,
        examTypeId: examCfg._dbId || null,
        attemptId: attempt ? attempt.Id : null,
        questionIds: ids,
        pausePolicy: policy,
        pauses: pauseState,
      });
    } catch(_){ }

    // Include minimal exam blueprint for the client when selecting inline
    const blueprint = {
      id: examCfg.id,
      nome: examCfg.nome,
      numeroQuestoes: examCfg.numeroQuestoes,
      duracaoMinutos: examCfg.duracaoMinutos,
      pausas: examCfg.pausas,
      opcoesPorQuestao: examCfg.opcoesPorQuestao,
      multiplaSelecao: examCfg.multiplaSelecao,
    };

    // Enrichment: always load imagem_url for all selected ids (covers cases where base SELECT dropped or returned null)
    try {
      const allIdsForImg = (payloadQuestions || []).map(q => Number(q.id)).filter(n => Number.isFinite(n));
      if (allIdsForImg.length) {
        const imgRows = await sequelize.query('SELECT id, imagem_url FROM public.questao WHERE id IN (:ids)', {
          replacements: { ids: allIdsForImg },
          type: sequelize.QueryTypes.SELECT,
        });
        const imgById = new Map((imgRows || []).map(r => [Number(r.id), (r.imagem_url != null && r.imagem_url !== '') ? String(r.imagem_url) : null]));
        payloadQuestions = (payloadQuestions || []).map(q => {
          if (!q) return q;
          const fresh = imgById.get(Number(q.id));
          // Precedence: use non-empty fresh value over existing; keep both aliases synced
          const finalImg = fresh || q.imagem_url || q.imagemUrl || null;
          return { ...q, imagem_url: finalImg, imagemUrl: finalImg };
        });
        // Debug after enrichment for Q266
        try {
          const enrichedQ266 = payloadQuestions.find(q => q && Number(q.id) === 266);
          if (enrichedQ266) console.debug('[selectQuestions] enriched Q266 imagem_url length=', enrichedQ266.imagem_url ? String(enrichedQ266.imagem_url).length : 0, 'prefix50=', enrichedQ266.imagem_url ? String(enrichedQ266.imagem_url).slice(0,50) : null);
        } catch(_) {}
      }
    } catch(e) { /* ignore enrichment errors */ }

    // Optional debug header: if client sends X-Debug-Images:true add lengths summary
    const wantDebugImages = String(req.get('X-Debug-Images') || '').toLowerCase() === 'true';
    if (wantDebugImages) {
      try {
        const dbg = payloadQuestions.filter(q => q && q.id).map(q => ({ id: q.id, len: q.imagem_url ? String(q.imagem_url).length : 0 }));
        res.set('X-Images-Debug', encodeURIComponent(JSON.stringify(dbg.slice(0, 50))));
      } catch(_) {}
    }

    return res.json({ sessionId, total: payloadQuestions.length, examType: examCfg.id, examMode: examMode || null, attemptId: attempt ? attempt.Id : null, exam: blueprint, questions: payloadQuestions });
  } catch (err) {
    console.error('Erro selectQuestions:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// Placeholder for starting a persisted exam/session (not implemented yet)
exports.startExam = async (req, res) => {
  try {
    return res.status(501).json({ message: 'startExam not implemented yet' });
  } catch (err) {
    console.error('Erro startExam:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// POST /api/exams/submit
// Body: { sessionId: string, answers: [{ questionId: number, optionId?: number, optionIds?: number[], response?: any }] }
// Used by: frontend/assets/build/script_exam.js e frontend/script_exam.js quando o usuário finaliza ou salva parcialmente
exports.submitAnswers = async (req, res) => {
  try {
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    // resolve user (same as other endpoints)
    let user = null;
    if (/^\d+$/.test(sessionToken)) {
      user = await User.findByPk(Number(sessionToken));
    }
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

  const { sessionId, answers } = req.body || {};
    const partial = Boolean(req.body && req.body.partial);
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers required' });
  const s = getSession(sessionId);
  let attemptId = s && s.attemptId ? Number(s.attemptId) : null;
  // Fallback: recover attemptId from DB when memory session is missing (e.g., server restart)
  if (!attemptId) {
    try {
      const Op = db.Sequelize && db.Sequelize.Op;
      // First, try by Meta.sessionId match for this user and in-progress status
      let attempt = null;
      try {
        // Prefer JSON lookup if supported
        attempt = await db.ExamAttempt.findOne({
          where: {
            UserId: user.Id || user.id,
            Status: 'in_progress',
            ...(Op ? { [Op.and]: [ db.sequelize.where(db.sequelize.json('meta.sessionId'), sessionId) ] } : {}),
          },
          order: [['StartedAt', 'DESC']],
        });
      } catch(_) { attempt = null; }
      // If not found (e.g., older attempts without Meta), fallback to latest in_progress for user
      if (!attempt) {
        attempt = await db.ExamAttempt.findOne({ where: { UserId: user.Id || user.id, Status: 'in_progress' }, order: [['StartedAt', 'DESC']] });
      }
      if (attempt && attempt.Id) attemptId = Number(attempt.Id);
    } catch(_){ /* keep attemptId as null if lookup fails */ }
  }

    // collect question ids: prefer session questionIds to ensure unanswered are included
    let qids = (s && Array.isArray(s.questionIds) && s.questionIds.length) ? s.questionIds.map(Number) : [];
    if (!qids.length) {
      qids = Array.from(new Set(answers.map(a => Number(a.questionId)).filter(n => !Number.isNaN(n))));
    }
    if (!qids.length) return res.status(400).json({ error: 'no valid questionIds' });

    // Fetch IsPreTest flags for questions to exclude from scoring
    let pretestQids = new Set();
    if (attemptId) {
      try {
        const pretestQ = `SELECT "QuestionId" FROM exam_attempt_question WHERE "AttemptId" = :aid AND "IsPreTest" = TRUE`;
        const pretestRows = await sequelize.query(pretestQ, { replacements: { aid: attemptId }, type: sequelize.QueryTypes.SELECT });
        pretestQids = new Set((pretestRows || []).map(r => Number(r.QuestionId || r.questionid)).filter(n => Number.isFinite(n)));
      } catch(e) { /* ignore if column doesn't exist yet */ }
    }

    // fetch correct option ids from respostaopcao
    const correctQ = `SELECT id, idquestao
      FROM respostaopcao
      WHERE iscorreta = true AND idquestao IN (:qids)`;
    const correctRows = await sequelize.query(correctQ, { replacements: { qids }, type: sequelize.QueryTypes.SELECT });

    const correctByQ = {};
    (correctRows || []).forEach(r => {
      if (r && (r.id || r.Id) && (r.idquestao || r.IdQuestao)) {
        correctByQ[Number(r.idquestao || r.IdQuestao)] = Number(r.id || r.Id);
      }
    });

    // grade (single or multi)
    let totalCorrect = 0;
  // build answers map and compute grading across all qids (unanswered => not correct)
    const byQ = new Map();
    (answers || []).forEach(a => {
      const qid = Number(a && a.questionId);
      if (!Number.isFinite(qid)) return;
      if (a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(a, 'response')) {
        byQ.set(qid, { typed: true, response: a.response });
      } else if (Array.isArray(a.optionIds)) {
        const ids = a.optionIds.map(Number).filter(n => Number.isFinite(n));
        byQ.set(qid, { multi: true, optionIds: ids });
      } else {
        const id = (a && a.optionId != null) ? Number(a.optionId) : null;
        byQ.set(qid, { multi: false, optionId: Number.isFinite(id) ? id : null });
      }
    });

    const details = qids.map(qid => {
      const rec = byQ.get(Number(qid));
      const isPretest = pretestQids.has(Number(qid));
      let ok = false;
      if (rec && rec.typed) {
        ok = false; // typed grading engine TBD
      } else if (rec && rec.multi) {
        const chosenSet = new Set((rec.optionIds || []).map(Number));
        const correctSet = new Set([correctByQ[qid]].filter(Boolean));
        ok = chosenSet.size === correctSet.size && [...chosenSet].every(x => correctSet.has(x));
      } else {
        const chosen = rec ? rec.optionId : null;
        const correctOpt = correctByQ[qid] || null;
        ok = !!(correctOpt && chosen != null && Number(chosen) === Number(correctOpt));
      }
      // Only count toward score if not pretest
      if (ok && !isPretest) totalCorrect += 1;
      return { questionId: Number(qid), chosenOptionId: (rec && rec.multi === false) ? (rec.optionId ?? null) : null, correct: ok, isPretest };
    });

    // Calculate scorable questions (exclude pretest)
    const scorableQids = qids.filter(qid => !pretestQids.has(Number(qid)));
    const result = { sessionId, totalQuestions: qids.length, totalScorableQuestions: scorableQids.length, totalCorrect, details };

    // Persist answers if we have an attempt
    try {
      if (attemptId) {
        // if partial, only consider questions present in payload; else consider all qids (for final)
        const persistQids = partial ? Array.from(byQ.keys()) : qids;
        const aqRows = await db.ExamAttemptQuestion.findAll({ where: { AttemptId: attemptId, QuestionId: persistQids } });
        const aqMap = new Map(aqRows.map(r => [Number(r.QuestionId), Number(r.Id)]));
        // Build toInsert with selected answers only (for partial), or include null markers (for final)
        const toInsert = [];

        if (partial) {
          // Replace answers for provided questions with current snapshot
          const aqIdsToReplace = [];
          for (const a of (answers || [])) {
            const qid = Number(a.questionId);
            const aqid = aqMap.get(qid);
            if (!aqid) continue;
            aqIdsToReplace.push(aqid);
          }
          if (aqIdsToReplace.length) {
            await db.ExamAttemptAnswer.destroy({ where: { AttemptQuestionId: aqIdsToReplace } });
          }
          for (const a of (answers || [])) {
            const qid = Number(a.questionId);
            const aqid = aqMap.get(qid);
            if (!aqid) continue;
            if (a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(a, 'response')) {
              const payload = a.response == null ? null : a.response;
              toInsert.push({ AttemptQuestionId: aqid, OptionId: null, Resposta: payload, Selecionada: payload != null });
            } else if (Array.isArray(a.optionIds)) {
              const arr = a.optionIds.map(Number).filter(n => Number.isFinite(n));
              for (const optId of arr) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId, Selecionada: true });
            } else {
              const optId = (a && a.optionId != null) ? Number(a.optionId) : null;
              if (Number.isFinite(optId)) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId, Selecionada: true });
            }
          }
          if (toInsert.length) await db.ExamAttemptAnswer.bulkCreate(toInsert);
        } else {
          // Final submission: include null markers for unanswered
          for (const a of (answers || [])) {
            const qid = Number(a.questionId);
            const aqid = aqMap.get(qid);
            if (!aqid) continue;
            if (a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(a, 'response')) {
              const payload = a.response == null ? null : a.response;
              toInsert.push({ AttemptQuestionId: aqid, OptionId: null, Resposta: payload, Selecionada: payload != null });
            } else if (Array.isArray(a.optionIds)) {
              const arr = a.optionIds.map(Number).filter(n => Number.isFinite(n));
              if (!arr.length) {
                toInsert.push({ AttemptQuestionId: aqid, OptionId: null, Selecionada: false });
              } else {
                for (const optId of arr) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId, Selecionada: true });
              }
            } else {
              const optId = (a && a.optionId != null) ? Number(a.optionId) : null;
              if (Number.isFinite(optId)) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId, Selecionada: true });
              else toInsert.push({ AttemptQuestionId: aqid, OptionId: null, Selecionada: false });
            }
          }
          // insert null for any missing
          const answeredSet = new Set((answers || []).map(x => Number(x.questionId)).filter(n => Number.isFinite(n)));
          for (const qid of qids) {
            const nq = Number(qid);
            if (!answeredSet.has(nq)) {
              const aqid = aqMap.get(nq);
              if (aqid) toInsert.push({ AttemptQuestionId: aqid, OptionId: null, Resposta: null, Selecionada: false });
            }
          }
          if (toInsert.length) await db.ExamAttemptAnswer.bulkCreate(toInsert, { ignoreDuplicates: true });
        }

        // Score and finish attempt only if not partial
        // Always refresh LastActivityAt on any submission
        if (attemptId) {
          try {
            await db.ExamAttempt.update({ LastActivityAt: new Date() }, { where: { Id: attemptId } });
          } catch(_) { /* ignore activity update errors */ }
        }
        if (!partial) {
          const examSlug = (s && s.examType) || 'pmp';
          const examCfg = await getExamTypeBySlugOrDefault(examSlug);
          // Use scorableQids for percentage calculation (exclude pretest)
          const scorableCount = scorableQids.length;
          const percent = scorableCount > 0 ? (totalCorrect * 100.0) / scorableCount : 0;
          const aprovado = (examCfg && examCfg.pontuacaoMinima != null) ? (percent >= Number(examCfg.pontuacaoMinima)) : null;
          await db.ExamAttempt.update({
            Corretas: totalCorrect,
            Total: scorableCount, // store scorable count (excludes pretest)
            ScorePercent: percent,
            Aprovado: aprovado,
            Status: 'finished',
            FinishedAt: new Date(),
            StatusReason: 'user_finish',
            LastActivityAt: new Date(),
          }, { where: { Id: attemptId } });
          // Stats: increment finished count with score percent
          try { if (attemptId) await userStatsService.incrementFinished(user.Id || user.id, percent); } catch(_) {}
        }
      }
    } catch (e) { console.warn('submitAnswers persistence warning:', e); }

    // For partial submissions, just acknowledge ok and include counts that were computed
    if (partial) return res.json({ ok: true, sessionId, saved: (answers || []).length, totalKnown: qids.length, totalScorableQuestions: scorableQids.length, totalCorrect });
    return res.json(result);
  } catch (err) {
    console.error('Erro submitAnswers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/start-on-demand
// Body: { count, filters... }
// Returns { sessionId, total }
// Used by: (reservado para fluxo alternativo; não há chamada ativa no frontend no momento)
exports.startOnDemand = async (req, res) => {
  try {
  const examType = (req.body && req.body.examType) || (req.get('X-Exam-Type') || '').trim() || 'pmp';
  const examCfg = await getExamTypeBySlugOrDefault(examType);
  // Resolve exam mode from header or infer by count
  let headerMode = (req.get('X-Exam-Mode') || '').trim().toLowerCase();
  if (!(headerMode === 'quiz' || headerMode === 'full')) headerMode = null;
  let count = Number((req.body && req.body.count) || 0) || 0;
    if (!count || count <= 0) return res.status(400).json({ error: 'count required' });
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bloqueio = Boolean(user.BloqueioAtivado);
    if (bloqueio && count > 25) count = 25;
    // Infer mode when header not provided: full when count >= blueprint total; quiz when count < full threshold
    let examMode = headerMode;
    try {
      if (!examMode) {
        const fullThreshold = (examCfg && Number(examCfg.numeroQuestoes)) ? Number(examCfg.numeroQuestoes) : getFullExamQuestionCount();
        if (count >= fullThreshold) examMode = 'full';
        else if (count > 0 && count < fullThreshold) examMode = 'quiz';
      }
    } catch(_) { examMode = examMode || null; }

  const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;
  const areas = Array.isArray(req.body.areas) && req.body.areas.length ? req.body.areas.map(Number) : null;
  const grupos = Array.isArray(req.body.grupos) && req.body.grupos.length ? req.body.grupos.map(Number) : null;
  const hasFilters = Boolean((dominios && dominios.length) || (areas && areas.length) || (grupos && grupos.length));
    const whereClauses = [`excluido = false`, `idstatus = 1`];
    if (examCfg && examCfg._dbId) {
      whereClauses.push(`exam_type_id = ${Number(examCfg._dbId)}`);
    }
    if (bloqueio) whereClauses.push(`seed = true`);
    if (dominios && dominios.length) whereClauses.push(`iddominio IN (${dominios.join(',')})`);
    if (areas && areas.length) whereClauses.push(`codareaconhecimento IN (${areas.join(',')})`);
    if (grupos && grupos.length) whereClauses.push(`codgrupoprocesso IN (${grupos.join(',')})`);
    const whereSql = whereClauses.join(' AND ');

    const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { type: sequelize.QueryTypes.SELECT });
    let available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;

    // Always respect exam type; no fallback that drops exam_type
    const whereSqlUsed = whereSql;
    if (available < 1) return res.status(400).json({ error: 'Not enough questions available', available });
    const limitUsed = Math.min(count, available);

    const selectIdsQ = `SELECT q.id FROM questao q WHERE ${whereSqlUsed} ORDER BY random() LIMIT :limit`;
    const rows = await sequelize.query(selectIdsQ, { replacements: { limit: limitUsed }, type: sequelize.QueryTypes.SELECT });
    const questionIds = rows.map(r => r.id || r.Id);
    const sessionId = genSessionId();
    // initialize pause state based on policy
    const policy = examCfg.pausas || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    const pauseState = { pauseUntil: 0, consumed: {} };
    (policy.checkpoints || []).forEach((cp) => { pauseState.consumed[cp] = false; });

    // Persist attempt and ordered questions
    const orm = db.sequelize;
    let attempt = null;
    await orm.transaction(async (t) => {
      attempt = await db.ExamAttempt.create({
        UserId: user.Id || user.id,
        ExamTypeId: examCfg._dbId || null,
        Modo: 'on-demand',
        QuantidadeQuestoes: questionIds.length,
        ExamMode: examMode || null,
        StartedAt: new Date(),
        LastActivityAt: new Date(),
        Status: 'in_progress',
        PauseState: pauseState,
        Meta: { sessionId, source: 'on-demand', examType: examCfg.id, examMode: examMode || null },
        BlueprintSnapshot: {
          id: examCfg.id,
          nome: examCfg.nome,
          numeroQuestoes: examCfg.numeroQuestoes,
          duracaoMinutos: examCfg.duracaoMinutos,
          pausas: policy,
          opcoesPorQuestao: examCfg.opcoesPorQuestao,
          multiplaSelecao: examCfg.multiplaSelecao,
          pontuacaoMinima: examCfg.pontuacaoMinima ?? null,
        },
  FiltrosUsados: { dominios, areas, grupos, fallbackIgnoreExamType: false },
      }, { transaction: t });
      if (attempt && questionIds.length) {
        const rows = questionIds.map((qid, idx) => ({ AttemptId: attempt.Id, QuestionId: qid, Ordem: idx + 1 }));
        await db.ExamAttemptQuestion.bulkCreate(rows, { transaction: t });
      }
    });

    // Stats: increment started count
    try { if (attempt && attempt.Id) await userStatsService.incrementStarted(attempt.UserId || (user && (user.Id || user.id))); } catch(_) {}

    putSession(sessionId, {
      userId: user.Id || user.id,
      examType: examCfg.id,
      examTypeId: examCfg._dbId || null,
      attemptId: attempt ? attempt.Id : null,
      questionIds,
      pausePolicy: policy,
      pauses: pauseState,
    });

    return res.json({ sessionId, total: questionIds.length, examType: examCfg.id, examMode: examMode || null, attemptId: attempt ? attempt.Id : null, exam: {
      id: examCfg.id,
      nome: examCfg.nome,
      numeroQuestoes: examCfg.numeroQuestoes,
      duracaoMinutos: examCfg.duracaoMinutos,
      pausas: policy,
      opcoesPorQuestao: examCfg.opcoesPorQuestao,
      multiplaSelecao: examCfg.multiplaSelecao,
    }});
  } catch (err) {
    console.error('Erro startOnDemand:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// GET /api/exams/:sessionId/question/:index
// Used by: fluxo on-demand (quando ativo) para buscar questão a questão
exports.getQuestion = async (req, res) => {
  try {
    const { sessionId, index } = { sessionId: req.params.sessionId, index: Number(req.params.index) };
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index) || index < 0 || index >= s.questionIds.length) return res.status(400).json({ error: 'invalid index' });
    const qid = s.questionIds[index];
    const qQ = `
      SELECT q.id, q.descricao, q.tiposlug, q.interacaospec, q.multiplaescolha AS multiplaescolha,
             eg."Descricao" AS explicacao,
             qt.ui_schema AS ui_schema
        FROM questao q
        LEFT JOIN explicacaoguia eg
               ON eg.idquestao = q.id AND (eg."Excluido" = false OR eg."Excluido" IS NULL)
        LEFT JOIN question_type qt
               ON qt.slug = q.tiposlug AND (qt.ativo = TRUE OR qt.ativo IS NULL)
       WHERE q.id = :id
       LIMIT 1`;
    const qRows = await sequelize.query(qQ, { replacements: { id: qid }, type: sequelize.QueryTypes.SELECT });
    if (!qRows || !qRows.length) return res.status(404).json({ error: 'question not found' });
    const q = qRows[0];
    // If tiposlug is present but refers to advanced type, return interaction payload.
    // For basic types ('single'/'multi' or synonyms), keep legacy options path below.
    if (q.tiposlug) {
      const basic = (()=>{ try { const t = String(q.tiposlug).toLowerCase(); return (t === 'single' || t === 'radio' || t === 'multi' || t === 'multiple' || t === 'checkbox'); } catch(_) { return false; } })();
      if (!basic) {
        const interacao = q.interacaospec || null;
        return res.json({ index, total: s.questionIds.length, examType: s.examType || 'pmp', question: {
          id: q.id,
          type: q.tiposlug,
          descricao: q.descricao || q.Descricao,
          explicacao: q.explicacao || q.Explicacao,
          interacao,
          ui: q.ui_schema || null,
        }});
      }
    }
    // Legacy options-based question: include per-question type using questao.multiplaescolha
    const optsQ = `SELECT "Id" AS id, "IdQuestao" AS idquestao, "Descricao" AS descricao FROM respostaopcao WHERE ("Excluido" = false OR "Excluido" IS NULL) AND "IdQuestao" = :qid ORDER BY random()`;
    const opts = await sequelize.query(optsQ, { replacements: { qid }, type: sequelize.QueryTypes.SELECT });
    // derive type: when multiplaescolha true -> checkbox, else radio
    let type = (q.multiplaescolha === true || q.multiplaescolha === 't') ? 'checkbox' : 'radio';
    if (q.tiposlug) {
      const t = String(q.tiposlug).toLowerCase();
      if (t === 'multi' || t === 'multiple' || t === 'checkbox') type = 'checkbox';
      else if (t === 'single' || t === 'radio') type = 'radio';
    }
    return res.json({ index, total: s.questionIds.length, examType: s.examType || 'pmp', question: { id: q.id, type, descricao: q.descricao || q.Descricao, explicacao: q.explicacao || q.Explicacao, options: opts } });
  } catch (err) {
    console.error('Erro getQuestion:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/:sessionId/pause/start { index }
// Used by: frontend/pages/examFull.html para iniciar pausa nos checkpoints
exports.pauseStart = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const index = Number(req.body && req.body.index);
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index)) return res.status(400).json({ error: 'index required' });
    const policy = s.pausePolicy || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    if (!policy.permitido) return res.status(400).json({ error: 'pause not permitted for this exam' });
    const cps = Array.isArray(policy.checkpoints) ? policy.checkpoints : [];
    if (!cps.includes(index)) return res.status(400).json({ error: 'pause not allowed at this index' });
    const consumed = s.pauses && s.pauses.consumed ? s.pauses.consumed : {};
    if (consumed[index]) return res.status(400).json({ error: 'pause already consumed' });
    const ms = (Number(policy.duracaoMinutosPorPausa) || 0) * 60 * 1000;
    const until = Date.now() + ms;
    consumed[index] = true;
    updateSession(sessionId, { pauses: { ...s.pauses, pauseUntil: until, consumed }, pausePolicy: policy });
    return res.json({ ok: true, pauseUntil: until });
  } catch (err) {
    console.error('Erro pauseStart:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/:sessionId/pause/skip { index }
// Used by: frontend/pages/examFull.html para pular pausa no checkpoint
exports.pauseSkip = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const index = Number(req.body && req.body.index);
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index)) return res.status(400).json({ error: 'index required' });
    const policy = s.pausePolicy || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    const cps = Array.isArray(policy.checkpoints) ? policy.checkpoints : [];
    if (!cps.includes(index)) return res.status(400).json({ error: 'skip not allowed at this index' });
    const consumed = s.pauses && s.pauses.consumed ? s.pauses.consumed : {};
    if (consumed[index]) return res.status(200).json({ ok: true, already: true });
    consumed[index] = true;
    updateSession(sessionId, { pauses: { ...s.pauses, consumed } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro pauseSkip:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// GET /api/exams/:sessionId/pause/status
// Used by: frontend/pages/examFull.html para consultar o estado da pausa
exports.pauseStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    return res.json({ pauses: s.pauses || {}, policy: s.pausePolicy || null, examType: s.examType || 'pmp' });
  } catch (err) {
    console.error('Erro pauseStatus:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/resume
// Body: { sessionId?: string, attemptId?: number }
// Rebuilds in-memory session state after server restart, using DB as source of truth
// Used by: frontend/pages/exam.html e frontend/pages/examFull.html no auto-resume ao detectar 404 de sessão
exports.resumeSession = async (req, res) => {
  try {
    // Resolve user (same policy as other endpoints)
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await db.User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const reqSessionId = (req.body && req.body.sessionId) ? String(req.body.sessionId) : null;
    const reqAttemptId = (req.body && req.body.attemptId) ? Number(req.body.attemptId) : null;

    // Locate attempt
    let attempt = null;
    if (Number.isFinite(reqAttemptId) && reqAttemptId > 0) {
      attempt = await db.ExamAttempt.findOne({ where: { Id: reqAttemptId, UserId: user.Id || user.id, Status: 'in_progress' } });
    }
    if (!attempt && reqSessionId) {
      try {
        // Prefer JSON meta.sessionId match
        const Op = db.Sequelize && db.Sequelize.Op;
        attempt = await db.ExamAttempt.findOne({
          where: {
            UserId: user.Id || user.id,
            Status: 'in_progress',
            ...(Op ? { [Op.and]: [ db.sequelize.where(db.sequelize.json('meta.sessionId'), reqSessionId) ] } : {}),
          },
          order: [['StartedAt', 'DESC']],
        });
      } catch(_) { attempt = null; }
    }
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });

    // Load ordered question ids
    const rows = await db.ExamAttemptQuestion.findAll({
      where: { AttemptId: attempt.Id },
      order: [['Ordem', 'ASC']],
      attributes: ['QuestionId']
    });
    const questionIds = (rows || []).map(r => Number(r.QuestionId)).filter(n => Number.isFinite(n));

    // Rebuild pause policy/state from snapshot when available, else from exam type config
    let policy = null;
    try {
      const snap = attempt.BlueprintSnapshot || null;
      if (snap && typeof snap === 'object' && snap.pausas) policy = snap.pausas;
    } catch(_) { policy = null; }
    if (!policy) {
      try {
        const exType = await getExamTypeBySlugOrDefault((attempt.BlueprintSnapshot && attempt.BlueprintSnapshot.id) || 'pmp');
        policy = exType && exType.pausas ? exType.pausas : { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
      } catch(_) { policy = { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 }; }
    }

    const pauseState = attempt.PauseState || { pauseUntil: 0, consumed: {} };

    // Decide which sessionId to use: keep client-provided sessionId if available; otherwise mint a new one
    const newSessionId = reqSessionId || genSessionId();

    // Put in-memory session
    putSession(newSessionId, {
      userId: user.Id || user.id,
      examType: (attempt.BlueprintSnapshot && attempt.BlueprintSnapshot.id) || 'pmp',
      examTypeId: attempt.ExamTypeId || null,
      attemptId: attempt.Id,
      questionIds,
      pausePolicy: policy,
      pauses: pauseState,
    });

    return res.json({ ok: true, sessionId: newSessionId, attemptId: attempt.Id, total: questionIds.length, examType: (attempt.BlueprintSnapshot && attempt.BlueprintSnapshot.id) || 'pmp' });
  } catch (err) {
    console.error('Erro resumeSession:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

  // GET /api/exams/last
  // Returns summary of the last finished attempt for the resolved user
  // Response: { correct, total, scorePercent, approved, finishedAt, examTypeId }
  // Used by: frontend/index.html (loadLastExamResults) para alimentar o gauge de "Último exame"
  exports.lastAttemptSummary = async (req, res) => {
    try {
      // Resolve user using the same policy applied in selection endpoints
      const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
      if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

      let user = null;
      if (/^\d+$/.test(sessionToken)) {
        user = await db.User.findByPk(Number(sessionToken));
      }
      if (!user) {
        const Op = db.Sequelize && db.Sequelize.Op;
        const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
        user = await db.User.findOne({ where });
      }
      if (!user) return res.status(404).json({ error: 'User not found' });

      const attempt = await db.ExamAttempt.findOne({
        where: { UserId: user.Id || user.id, Status: 'finished' },
        order: [['FinishedAt', 'DESC']],
        attributes: ['Id','Corretas','Total','QuantidadeQuestoes','ScorePercent','Aprovado','StartedAt','FinishedAt','ExamTypeId','ExamMode']
      });
      if (!attempt) return res.status(204).end();

      const correct = Number(attempt.Corretas != null ? attempt.Corretas : 0);
      const total = Number(
        attempt.Total != null ? attempt.Total : (attempt.QuantidadeQuestoes != null ? attempt.QuantidadeQuestoes : 0)
      );
      let scorePercent = null;
      if (attempt.ScorePercent != null) {
        scorePercent = Number(attempt.ScorePercent);
        if (!Number.isFinite(scorePercent) && total > 0) scorePercent = (correct * 100.0) / total;
      } else {
        scorePercent = total > 0 ? (correct * 100.0) / total : 0;
      }

      // duration in seconds when both timestamps present
      let durationSeconds = null;
      try {
        if (attempt.StartedAt && attempt.FinishedAt) {
          const ms = new Date(attempt.FinishedAt) - new Date(attempt.StartedAt);
          if (Number.isFinite(ms)) durationSeconds = Math.max(0, Math.round(ms / 1000));
        }
      } catch(_) { durationSeconds = null; }

      return res.json({
        correct,
        total,
        scorePercent,
        approved: attempt.Aprovado == null ? null : !!attempt.Aprovado,
        startedAt: attempt.StartedAt,
        finishedAt: attempt.FinishedAt,
        examTypeId: attempt.ExamTypeId || null,
        durationSeconds,
        examMode: attempt.ExamMode || null
      });
    } catch (err) {
      console.error('Erro lastAttemptSummary:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  };

  // GET /api/exams/history?limit=3
  // Returns the last N finished attempts for the resolved user (default 3)
  // Response: [{ correct,total,scorePercent,approved,startedAt,finishedAt,examTypeId,durationSeconds }]
  // Used by: frontend/index.html (loadLastExamResults) para estilizar o gauge conforme regra dos últimos 3
  exports.lastAttemptsHistory = async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(10, Number(req.query.limit) || 3));
      const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
      if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

      let user = null;
      if (/^\d+$/.test(sessionToken)) user = await db.User.findByPk(Number(sessionToken));
      if (!user) {
        const Op = db.Sequelize && db.Sequelize.Op;
        const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
        user = await db.User.findOne({ where });
      }
      if (!user) return res.status(404).json({ error: 'User not found' });

      const attempts = await db.ExamAttempt.findAll({
        where: { UserId: user.Id || user.id, Status: 'finished' },
        order: [['FinishedAt', 'DESC']],
        limit,
        attributes: ['Id','Corretas','Total','QuantidadeQuestoes','ScorePercent','Aprovado','StartedAt','FinishedAt','ExamTypeId','ExamMode']
      });
      const out = (attempts || []).map(a => {
        const correct = Number(a.Corretas != null ? a.Corretas : 0);
        const total = Number(a.Total != null ? a.Total : (a.QuantidadeQuestoes != null ? a.QuantidadeQuestoes : 0));
        let scorePercent = null;
        if (a.ScorePercent != null) {
          scorePercent = Number(a.ScorePercent);
          if (!Number.isFinite(scorePercent) && total > 0) scorePercent = (correct * 100.0) / total;
        } else {
          scorePercent = total > 0 ? (correct * 100.0) / total : 0;
        }
        let durationSeconds = null;
        try {
          if (a.StartedAt && a.FinishedAt) {
            const ms = new Date(a.FinishedAt) - new Date(a.StartedAt);
            if (Number.isFinite(ms)) durationSeconds = Math.max(0, Math.round(ms / 1000));
          }
        } catch(_) { durationSeconds = null; }
        return {
          correct,
          total,
          scorePercent,
          approved: a.Aprovado == null ? null : !!a.Aprovado,
          startedAt: a.StartedAt,
          finishedAt: a.FinishedAt,
          examTypeId: a.ExamTypeId || null,
          durationSeconds,
          examMode: a.ExamMode || null
        };
      });
      return res.json(out);
    } catch (err) {
      console.error('Erro lastAttemptsHistory:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  };

  // POST /api/admin/exams/mark-abandoned
  // Marks in-progress attempts as abandoned based on inactivity and low progress rules.
  exports.markAbandonedAttempts = async (req, res) => {
    try {
      const db = require('../models');
      const policies = require('../config/examPolicies');
      const { computeAttemptProgress } = require('../utils/examProgress');
      const now = Date.now();
      const batchLimit = policies.BATCH_LIMIT || 250;
      const attempts = await db.ExamAttempt.findAll({ where: { Status: 'in_progress' }, order: [['StartedAt', 'ASC']], limit: batchLimit });
      let processed = 0; let markedTimeout = 0; let markedLowProgress = 0;
      for (const attempt of attempts) {
        processed++;
        const lastActivity = attempt.LastActivityAt || attempt.StartedAt || new Date();
        const hoursSinceActivity = (now - new Date(lastActivity).getTime()) / 3600000;
        const isFull = String(attempt.ExamMode || '').toLowerCase() === 'full';
        const inactivityLimit = isFull ? policies.INACTIVITY_TIMEOUT_FULL_HOURS : policies.INACTIVITY_TIMEOUT_DEFAULT_HOURS;
        const progress = await computeAttemptProgress(db, attempt.Id);
        const respondedPercent = progress.respondedPercent;
        let reason = null;
        if (hoursSinceActivity >= inactivityLimit) {
          reason = 'timeout_inactivity'; markedTimeout++;
        } else if (hoursSinceActivity >= policies.ABANDON_THRESHOLD_INACTIVITY_HOURS && respondedPercent < policies.ABANDON_THRESHOLD_PERCENT) {
          reason = 'abandoned_low_progress'; markedLowProgress++;
        }
        if (reason) {
          await db.ExamAttempt.update({ Status: 'abandoned', StatusReason: reason }, { where: { Id: attempt.Id } });
          // Stats: increment abandoned count (categorize by reason)
          try { await userStatsService.incrementAbandoned(attempt.UserId || attempt.UserID || attempt.user_id, reason); } catch(_) {}
        }
      }
      return res.json({ ok: true, processed, markedTimeout, markedLowProgress });
    } catch (err) {
      console.error('Erro markAbandonedAttempts:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  };

  // POST /api/admin/exams/purge-abandoned
  // Purges abandoned attempts older than policy age and low progress threshold.
  exports.purgeAbandonedAttempts = async (req, res) => {
    try {
      const db = require('../models');
      const policies = require('../config/examPolicies');
      const { computeAttemptProgress } = require('../utils/examProgress');
      const now = Date.now();
      const cutoffMs = now - policies.PURGE_AFTER_DAYS * 86400000;
      const batchLimit = policies.BATCH_LIMIT || 250;
      const attempts = await db.ExamAttempt.findAll({ where: { Status: 'abandoned' }, order: [['StartedAt', 'ASC']], limit: batchLimit });
      let inspected = 0; let purged = 0;
      for (const attempt of attempts) {
        inspected++;
        const startedMs = new Date(attempt.StartedAt || new Date()).getTime();
        if (startedMs > cutoffMs) continue;
        const progress = await computeAttemptProgress(db, attempt.Id);
        if (progress.respondedPercent >= policies.PURGE_LOW_PROGRESS_PERCENT) continue;
        const snapshot = {
          AttemptId: attempt.Id,
          UserId: attempt.UserId || null,
          ExamTypeId: attempt.ExamTypeId || null,
          ExamMode: attempt.ExamMode || null,
          QuantidadeQuestoes: attempt.QuantidadeQuestoes || null,
          RespondedCount: progress.respondedCount,
          RespondedPercent: progress.respondedPercent,
          StatusBefore: attempt.Status,
          StatusReasonBefore: attempt.StatusReason || null,
          StartedAt: attempt.StartedAt || null,
          FinishedAt: attempt.FinishedAt || null,
          PurgeReason: 'policy',
          Meta: attempt.Meta || null,
        };
        await db.sequelize.transaction(async (t) => {
          await db.ExamAttemptPurgeLog.create(snapshot, { transaction: t });
          const aqRows = await db.ExamAttemptQuestion.findAll({ where: { AttemptId: attempt.Id }, attributes: ['Id'], transaction: t });
          const aqIds = aqRows.map(r => r.Id);
          if (aqIds.length) await db.ExamAttemptAnswer.destroy({ where: { AttemptQuestionId: aqIds }, transaction: t });
          await db.ExamAttemptQuestion.destroy({ where: { AttemptId: attempt.Id }, transaction: t });
          await db.ExamAttempt.destroy({ where: { Id: attempt.Id }, transaction: t });
        });
        purged++;
        // Stats: increment purged count
        try { await userStatsService.incrementPurged(attempt.UserId || attempt.UserID || attempt.user_id); } catch(_) {}
      }
      return res.json({ ok: true, inspected, purged });
    } catch (err) {
      console.error('Erro purgeAbandonedAttempts:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  };