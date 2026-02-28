const sequelize = require('../config/database');

const { logger } = require('../utils/logger');
const { internalError } = require('../middleware/errors');
const userParamsStore = require('../services/userParamsStore');
const llmClient = require('../services/llmClient');
// Helper: list grupos de processo preferindo a coluna que casa com questao.codgrupoprocesso
async function listGruposProcessoSmart(req, res, next, table) {
  try {
    const cols = await sequelize.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
      { replacements: { tbl: table }, type: sequelize.QueryTypes.SELECT }
    );

    const names = new Set((cols || []).map(c => c.column_name));
    const types = new Map((cols || []).map(c => [c.column_name, c.data_type]));

    // Prefer the code column used by questao: codgrupoprocesso
    let idCol = null;
    if (names.has('codgrupoprocesso')) idCol = 'codgrupoprocesso';
    else if (names.has('CodGrupoProcesso')) idCol = '"CodGrupoProcesso"';
    else if (names.has('CODGRUPOPROCESSO')) idCol = '"CODGRUPOPROCESSO"';
    else if (names.has('id')) idCol = 'id';
    else if (names.has('Id')) idCol = '"Id"';

    let descCol = null;
    if (names.has('descricao')) descCol = 'descricao';
    else if (names.has('Descricao')) descCol = '"Descricao"';

    if (!idCol || !descCol) {
      logger.warn(`[meta] ${table} missing expected columns. columns=`, Array.from(names));
      return next(internalError('Erro interno', 'TABLE_MISSING_COLUMNS', { table, columns: Array.from(names) }));
    }

    const whereClauses = [];
    if (names.has('excluido')) whereClauses.push('(excluido = false OR excluido IS NULL)');
    else if (names.has('Excluido')) whereClauses.push('("Excluido" = false OR "Excluido" IS NULL)');

    if (names.has('status')) {
      const t = String(types.get('status') || '').toLowerCase();
      whereClauses.push(t === 'boolean' ? '(status = TRUE)' : '(status = 1)');
    } else if (names.has('Status')) {
      const t = String(types.get('Status') || '').toLowerCase();
      whereClauses.push(t === 'boolean' ? '("Status" = TRUE)' : '("Status" = 1)');
    }

    const where = whereClauses.length ? ('WHERE ' + whereClauses.join(' AND ')) : '';
    const sql = `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${table} ${where}`;
    const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
    return res.json(rows || []);
  } catch (e) {
    logger.error(`[meta] listGruposProcessoSmart ${table} error`, e);
    return next(internalError('Erro interno', 'GRUPO_PROCESSO_LIST_ERROR', e));
  }
}
// Helper to run a robust select id, descricao from a table, adapting to column name casing
async function listSimple(req, res, next, table) {
  try {
    // Discover available columns for the table to avoid referencing non-existing columns
    const cols = await sequelize.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
      { replacements: { tbl: table }, type: sequelize.QueryTypes.SELECT }
    );
    const names = new Set((cols || []).map(c => c.column_name));
    const types = new Map((cols || []).map(c => [c.column_name, c.data_type]));

    // Determine id and descricao column identifiers (with proper quoting when needed)
    let idCol = null;
    if (names.has('id')) idCol = 'id'; else if (names.has('Id')) idCol = '"Id"';
    let descCol = null;
    if (names.has('descricao')) descCol = 'descricao'; else if (names.has('Descricao')) descCol = '"Descricao"';
    if (!idCol || !descCol) {
      logger.warn(`[meta] ${table} missing expected id/descricao columns. columns=`, Array.from(names));
      return next(internalError('Erro interno', 'TABLE_MISSING_COLUMNS', { table, columns: Array.from(names) }));
    }

    // Optional filters when columns exist
    const whereClauses = [];
    // Soft-delete filter (excluido)
    if (names.has('excluido')) whereClauses.push('(excluido = false OR excluido IS NULL)');
    else if (names.has('Excluido')) whereClauses.push('("Excluido" = false OR "Excluido" IS NULL)');

    // Active/status filter (status) — requested for areaconhecimento; safe for other tables
    if (names.has('status')) {
      const t = String(types.get('status') || '').toLowerCase();
      whereClauses.push(t === 'boolean' ? '(status = TRUE)' : '(status = 1)');
    } else if (names.has('Status')) {
      const t = String(types.get('Status') || '').toLowerCase();
      whereClauses.push(t === 'boolean' ? '("Status" = TRUE)' : '("Status" = 1)');
    }

    const where = whereClauses.length ? ('WHERE ' + whereClauses.join(' AND ')) : '';

    const sql = `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${table} ${where}`;
    const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
    return res.json(rows || []);
  } catch (e) {
    logger.error(`[meta] list ${table} error`, e);
    return next(internalError('Erro interno', 'META_LIST_ERROR', e));
  }
}

exports.listAreasConhecimento = (req, res, next) => listSimple(req, res, next, 'areaconhecimento');
exports.listGruposProcesso = async (req, res, next) => {
  // prefer 'grupoprocesso'; some DBs might use 'gruprocesso' — try fallback
  try {
    return await listGruposProcessoSmart(req, res, next, 'grupoprocesso');
  } catch (e) {
    try { return await listSimple(req, res, next, 'gruprocesso'); } catch (e2) {
      logger.error('[meta] both grupoprocesso/gruprocesso failed');
      return next(internalError('Erro interno', 'GRUPO_PROCESSO_LIST_ERROR', e2));
    }
  }
};
exports.listDominios = (req, res, next) => listSimple(req, res, next, 'dominio_desempenho');
exports.listDominiosGeral = (req, res, next) => listSimple(req, res, next, 'dominiogeral');
exports.listPrincipios = (req, res, next) => listSimple(req, res, next, 'principios');
exports.listCategorias = (req, res, next) => listSimple(req, res, next, 'abordagem');
exports.listAbordagens = exports.listCategorias;
// List difficulty levels from niveldificuldade table
exports.listNiveisDificuldade = async (req, res, next) => {
  try {
    const rows = await sequelize.query(
      `SELECT codigonivel AS id, descricao FROM niveldificuldade ORDER BY codigonivel`,
      { type: sequelize.QueryTypes.SELECT }
    );
    return res.json(rows || []);
  } catch (e) {
    logger.error('[meta] listNiveisDificuldade error', e);
    return next(internalError('Erro interno', 'LIST_NIVEIS_DIFICULDADE_ERROR', e));
  }
};

// List tasks from task table (only active)
exports.listTasks = async (req, res, next) => {
  try {
    // Join dominiogeral to compose label: dominiogeral.descricao - Tasks.numero - Tasks.descricao
    // Return as id, descricao (formatted) to keep frontend compatibility
    const rows = await sequelize.query(
      `SELECT t.id,
              (COALESCE(dg.descricao,'') ||' - Task ' || t.numero || ' | - ' || t.descricao) AS descricao
         FROM public."Tasks" t
         LEFT JOIN public.dominiogeral dg ON dg.id = t.id_dominio
        WHERE t.ativo = TRUE
        ORDER BY t.id_dominio`,
      { type: sequelize.QueryTypes.SELECT }
    );
    return res.json(rows || []);
  } catch (e) {
    logger.error('[meta] listTasks error', e);
    return next(internalError('Erro interno', 'LIST_TASKS_ERROR', e));
  }
};

// GET /api/meta/config -> expose server-side config relevant to frontend
exports.getConfig = async (_req, res, next) => {
  try {
    // Read from admin-configurable user params (fallbacks to env/defaults).
    const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
    const fullExamQuestionCount = Number(params && params.fullExamQuestionCount);
    const freeExamQuestionLimit = Number(params && params.freeExamQuestionLimit);

    const examVersion = (process.env.EXAM_VER || '').trim();
    const llmProvider = llmClient.getProvider();
    const llmEnabled = llmClient.isEnabled();

    // Legacy name used by the frontend to show/hide Insights IA.
    // Keep it, but make it reflect the effective LLM availability (Gemini or Ollama).
    const ollamaEnabled = llmEnabled;

    return res.json({
      fullExamQuestionCount,
      freeExamQuestionLimit,
      examVersion,
      ollamaEnabled,
      llmEnabled,
      llmProvider,
    });
  } catch (e) {
    return next(internalError('Erro interno', 'GET_CONFIG_ERROR', e));
  }
};

// GET /api/meta/user-params -> expose safe user entitlement params for frontend gating
exports.getUserParams = async (_req, res, next) => {
  try {
    const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
    return res.json({ ok: true, params: userParamsStore.toPublicParams(params) });
  } catch (e) {
    return next(internalError('Erro interno', 'GET_USER_PARAMS_ERROR', e));
  }
};

// List distinct versao_exame values from questao for select options
exports.listVersoesExame = async (_req, res, next) => {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT versao_exame AS descricao
         FROM public.questao
        WHERE versao_exame IS NOT NULL AND TRIM(versao_exame) <> ''
        ORDER BY versao_exame`,
      { type: sequelize.QueryTypes.SELECT }
    );
    // Map to id/descricao shape using the string as both id and descricao
    const items = (rows || []).map(r => ({ id: r.descricao, descricao: r.descricao }));
    return res.json(items);
  } catch (e) {
    logger.error('[meta] listVersoesExame error', e);
    return next(internalError('Erro interno', 'LIST_VERSOES_EXAME_ERROR', e));
  }
};
