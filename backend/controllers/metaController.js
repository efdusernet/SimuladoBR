const sequelize = require('../config/database');

// Helper: detect a column name from candidates that exists in a table
async function detectColumn(table, candidates) {
  try {
    const q = `SELECT column_name FROM information_schema.columns WHERE table_name = :table AND column_name = ANY(:candidates)`;
    const rows = await sequelize.query(q, { replacements: { table, candidates }, type: sequelize.QueryTypes.SELECT });
    if (Array.isArray(rows) && rows.length) return rows[0].column_name;
  } catch (e) {
    // ignore
  }
  return null;
}

async function listMeta(req, res, tableName) {
  try {
    // detect id-like and descricao-like columns
    const idCandidates = ['id', 'Id', 'ID'];
    const descCandidates = ['descricao', 'Descricao', 'nome', 'Nome', 'label', 'Label'];

    const idCol = await detectColumn(tableName, idCandidates) || 'id';
    const descCol = await detectColumn(tableName, descCandidates) || 'descricao';

    // Build safe SQL with quoted identifiers when necessary
    const safeId = (/^[a-z0-9_]+$/.test(idCol) ? idCol : `"${idCol}"`);
    const safeDesc = (/^[a-z0-9_]+$/.test(descCol) ? descCol : `"${descCol}"`);

    // try to include only non-excluded rows when possible
    const exclCandidates = ['excluido', 'Excluido', 'is_excluded', 'IsExcluido'];
    let exclCol = null;
    for (const c of exclCandidates) {
      // quick test using information_schema
      // note: detectColumn already queries information_schema; reuse it
      // but for simplicity, call detectColumn
      // (this is a small extra query and acceptable here)
      /* eslint-disable no-await-in-loop */
      // reuse detectColumn
      const found = await detectColumn(tableName, [c]);
      if (found) { exclCol = found; break; }
    }

    const safeExcl = exclCol ? (/^[a-z0-9_]+$/.test(exclCol) ? exclCol : `"${exclCol}"`) : null;

    const where = safeExcl ? `WHERE (${safeExcl} = false OR ${safeExcl} IS NULL)` : '';

    const sql = `SELECT ${safeId} AS id, ${safeDesc} AS descricao FROM ${tableName} ${where} ORDER BY descricao`;
    const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
    return res.json(rows.map(r => ({ id: r.id, descricao: r.descricao })));
  } catch (err) {
    console.error('meta list error', tableName, err && err.message);
    return res.status(500).json({ error: 'internal' });
  }
}

exports.listAreas = async (req, res) => listMeta(req, res, 'areaconhecimento');
exports.listGrupos = async (req, res) => listMeta(req, res, 'grupoprocesso');
exports.listDominios = async (req, res) => listMeta(req, res, 'dominio');

// keep module exports
module.exports = exports;
