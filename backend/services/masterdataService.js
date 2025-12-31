const sequelize = require('../config/database');
const { logger } = require('../utils/logger');

// Reusable DB access for masterdata lists used by the AI.
// NOTE: Table names are fixed/allowlisted (no user input).
async function listSimpleTable(table) {
  const cols = await sequelize.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
    { replacements: { tbl: table }, type: sequelize.QueryTypes.SELECT }
  );
  const names = new Set((cols || []).map(c => c.column_name));

  let idCol = null;
  if (names.has('id')) idCol = 'id';
  else if (names.has('Id')) idCol = '"Id"';

  let descCol = null;
  if (names.has('descricao')) descCol = 'descricao';
  else if (names.has('Descricao')) descCol = '"Descricao"';

  if (!idCol || !descCol) {
    const err = new Error(`TABLE_MISSING_COLUMNS:${table}`);
    err.code = 'TABLE_MISSING_COLUMNS';
    err.meta = { table, columns: Array.from(names) };
    throw err;
  }

  const conditions = [];
  if (names.has('excluido')) conditions.push('(excluido = false OR excluido IS NULL)');
  else if (names.has('Excluido')) conditions.push('("Excluido" = false OR "Excluido" IS NULL)');

  // All masterdata tables used by AI have a boolean "status" flag (true=active).
  if (names.has('status')) conditions.push('status = true');
  else if (names.has('Status')) conditions.push('"Status" = true');

  const where = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';

  const sql = `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${table} ${where}`;
  const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
  return rows || [];
}

async function listGruposProcesso() {
  // prefer 'grupoprocesso'; some DBs might use 'gruprocesso'
  try {
    return await listSimpleTable('grupoprocesso');
  } catch (e) {
    try {
      return await listSimpleTable('gruprocesso');
    } catch (e2) {
      logger.error('[masterdata] both grupoprocesso/gruprocesso failed');
      throw e2;
    }
  }
}

async function listTasks() {
  const rows = await sequelize.query(
    `SELECT t.id,
            (COALESCE(dg.descricao,'') ||' - Task ' || t.numero || ' | - ' || t.descricao) AS descricao
       FROM public."Tasks" t
       LEFT JOIN public.dominiogeral dg ON dg.id = t.id_dominio AND dg.status = TRUE
      WHERE t.status = TRUE
      ORDER BY t.id_dominio`,
    { type: sequelize.QueryTypes.SELECT }
  );
  return rows || [];
}

async function getQuestionClassificationMasterdata() {
  const [iddominiogeral, iddominio, idprincipio, codigocategoria, codgrupoprocesso, id_task] = await Promise.all([
    listSimpleTable('dominiogeral'),
    listSimpleTable('dominio'),
    listSimpleTable('principios'),
    listSimpleTable('categoriaquestao'),
    listGruposProcesso(),
    listTasks(),
  ]);

  return {
    iddominiogeral,
    iddominio,
    idprincipio,
    codigocategoria,
    codgrupoprocesso,
    id_task,
  };
}

module.exports = {
  getQuestionClassificationMasterdata,
};
