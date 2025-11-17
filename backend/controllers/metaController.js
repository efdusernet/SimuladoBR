const sequelize = require('../config/database');

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
      console.warn(`[meta] ${table} missing expected id/descricao columns. columns=`, Array.from(names));
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
    console.error(`[meta] list ${table} error`, e);
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
      console.error('[meta] both grupoprocesso/gruprocesso failed');
      return res.status(500).json({ error: 'internal error' });
    }
  }
};
exports.listDominios = (req, res) => listSimple(req, res, 'dominio');
exports.listDominiosGeral = (req, res) => listSimple(req, res, 'dominiogeral');
exports.listPrincipios = (req, res) => listSimple(req, res, 'principios');
exports.listCategorias = (req, res) => listSimple(req, res, 'categoriaquestao');

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
    return res.json({ fullExamQuestionCount, freeExamQuestionLimit });
  } catch (e) {
    return res.status(500).json({ error: 'internal error' });
  }
};
