const sequelize = require('../config/database');

const { logger } = require('../utils/logger');
// Helper to run a robust select id, descricao from a table, adapting to column name casing
async function listSimple(req, res, table) {
  try {
    // Discover available columns for the table to avoid referencing non-existing columns
    const cols = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
      { replacements: { tbl: table }, type: sequelize.QueryTypes.SELECT }
    );
    const names = new Set((cols || []).map(c => c.column_name));

    // Determine id and descricao column identifiers (with proper quoting when needed)
    let idCol = null;
    if (names.has('id')) idCol = 'id'; else if (names.has('Id')) idCol = '"Id"';
    let descCol = null;
    if (names.has('descricao')) descCol = 'descricao'; else if (names.has('Descricao')) descCol = '"Descricao"';
    if (!idCol || !descCol) {
      logger.warn(`[meta] ${table} missing expected id/descricao columns. columns=`, Array.from(names));
      return res.status(500).json({ error: `table ${table} missing id/descricao` });
    }

    // Optional soft-delete filter if present (excluido or "Excluido")
    let where = '';
    if (names.has('excluido')) where = 'WHERE (excluido = false OR excluido IS NULL)';
    else if (names.has('Excluido')) where = 'WHERE ("Excluido" = false OR "Excluido" IS NULL)';

    const sql = `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${table} ${where}`;
    const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
    return res.json(rows || []);
  } catch (e) {
    logger.error(`[meta] list ${table} error`, e);
    return res.status(500).json({ error: 'internal error' });
  }
}

exports.listAreasConhecimento = (req, res) => listSimple(req, res, 'areaconhecimento');
exports.listGruposProcesso = async (req, res) => {
  // prefer 'grupoprocesso'; some DBs might use 'gruprocesso' — try fallback
  try {
    return await listSimple(req, res, 'grupoprocesso');
  } catch (e) {
    try { return await listSimple(req, res, 'gruprocesso'); } catch (e2) {
      logger.error('[meta] both grupoprocesso/gruprocesso failed');
      return res.status(500).json({ error: 'internal error' });
    }
  }
};
exports.listDominios = (req, res) => listSimple(req, res, 'dominio');
exports.listDominiosGeral = (req, res) => listSimple(req, res, 'dominiogeral');
exports.listPrincipios = (req, res) => listSimple(req, res, 'principios');
exports.listCategorias = (req, res) => listSimple(req, res, 'categoriaquestao');
// List difficulty levels from niveldificuldade table
exports.listNiveisDificuldade = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT codigonivel AS id, descricao FROM niveldificuldade ORDER BY codigonivel`,
      { type: sequelize.QueryTypes.SELECT }
    );
    return res.json(rows || []);
  } catch (e) {
    logger.error('[meta] listNiveisDificuldade error', e);
    return res.status(500).json({ error: 'internal error' });
  }
};

// List tasks from task table (only active)
exports.listTasks = async (req, res) => {
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
    return res.status(500).json({ error: 'internal error' });
  }
};

// GET /api/meta/config -> expose server-side config relevant to frontend
exports.getConfig = (_req, res) => {
  try {
    const fullExamQuestionCount = (() => {
      const n = Number(process.env.FULL_EXAM_QUESTION_COUNT || 180);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180;
    })();
    const freeExamQuestionLimit = (() => {
      const n = Number(process.env.FREE_EXAM_QUESTION_LIMIT || 25);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
    })();
    const examVersion = (process.env.EXAM_VER || '').trim();
    return res.json({ fullExamQuestionCount, freeExamQuestionLimit, examVersion });
  } catch (e) {
    return res.status(500).json({ error: 'internal error' });
  }
};

// List distinct versao_exame values from questao for select options
exports.listVersoesExame = async (_req, res) => {
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
    return res.status(500).json({ error: 'internal error' });
  }
};
