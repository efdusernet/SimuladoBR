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

  let expCol = null;
  if (names.has('explicacao')) expCol = 'explicacao';
  else if (names.has('Explicacao')) expCol = '"Explicacao"';

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

  const select = expCol
    ? `SELECT ${idCol} AS id, ${descCol} AS descricao, ${expCol} AS explicacao FROM ${table} ${where}`
    : `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${table} ${where}`;

  const sql = select;
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
  // NOTE: "Tasks" is a legacy table that may use "ativo" instead of "status".
  const cols = await sequelize.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Tasks'`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const names = new Set((cols || []).map(c => c.column_name));

  const hasExp = names.has('explicacao') || names.has('Explicacao');
  const expSelect = names.has('explicacao') ? 't.explicacao' : (names.has('Explicacao') ? 't."Explicacao"' : null);

  const activeCondition = names.has('status')
    ? 't.status = TRUE'
    : (names.has('ativo') ? 't.ativo = TRUE' : null);

  if (!activeCondition) {
    const err = new Error('TABLE_MISSING_COLUMNS:Tasks');
    err.code = 'TABLE_MISSING_COLUMNS';
    err.meta = { table: 'Tasks', columns: Array.from(names) };
    throw err;
  }

  const dgCols = await sequelize.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dominiogeral'`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const dgNames = new Set((dgCols || []).map(c => c.column_name));
  const dgActiveJoin = dgNames.has('status') ? ' AND dg.status = TRUE' : '';

  const rows = await sequelize.query(
    `SELECT t.id AS id,
            (COALESCE(dg.descricao,'') || ' - Task ' || t.numero || ' | - ' || t.descricao) AS descricao
            ${hasExp ? `, ${expSelect} AS explicacao` : ''}
       FROM public."Tasks" t
       LEFT JOIN public.dominiogeral dg ON dg.id = t.id_dominio${dgActiveJoin}
      WHERE ${activeCondition}
      ORDER BY t.id_dominio, t.id`,
    { type: sequelize.QueryTypes.SELECT }
  );

  return rows || [];
}

async function getQuestionClassificationMasterdata() {
  const [iddominiogeral, iddominio_desempenho, idprincipio, id_abordagem, codgrupoprocesso, id_task] = await Promise.all([
    listSimpleTable('dominiogeral'),
    listSimpleTable('dominio_desempenho'),
    listSimpleTable('principios'),
    listSimpleTable('abordagem'),
    listGruposProcesso(),
    listTasks(),
  ]);

  return {
    iddominiogeral,
    iddominio_desempenho,
    idprincipio,
    id_abordagem,
    codgrupoprocesso,
    id_task,
  };
}

module.exports = {
  getQuestionClassificationMasterdata,
};
