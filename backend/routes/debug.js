const express = require('express');
const router = express.Router();
const db = require('../models');
const crypto = require('crypto');
const { generateVerificationCode } = require('../utils/codegen');
const { sendVerificationEmail } = require('../utils/mailer');

// Dev-only endpoint: retorna o usuário atual do Postgres e variáveis relevantes
router.get('/db-user', async (req, res) => {
  try {
    // Query diretamente para saber qual usuário o Postgres reconhece
    const [results] = await db.sequelize.query("SELECT current_user as current_user;");
    return res.json({
      env_DB_USER: process.env.DB_USER || null,
      sequelize_username: db.sequelize.config && (db.sequelize.config.username || db.sequelize.config.user) || null,
      postgres_current_user: results && results[0] && results[0].current_user || null
    });
  } catch (err) {
    console.error('Erro debug db-user:', err);
    return res.status(500).json({ error: 'Erro ao consultar DB' });
  }
});

// Admin: fetch latest N rows from response_times for inspection
router.get('/response-times', async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit || req.body && req.body.limit || '100', 10) || 100;
    const limit = Math.max(1, Math.min(1000, rawLimit));

    // Basic protection: allow in non-production without auth; in production require an admin user
    const sessionToken = (req.get('X-Session-Token') || req.query.token || '').trim();
    let allow = false;
    if (process.env.NODE_ENV !== 'production') allow = true;
    let user = null;
    if (sessionToken) {
      if (/^\d+$/.test(sessionToken)) user = await db.User.findByPk(Number(sessionToken));
      if (!user) {
        const Op = db.Sequelize && db.Sequelize.Op;
        const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
        user = await db.User.findOne({ where });
      }
      if (user) {
        const adminName = (process.env.ADMIN_USER || 'admin').toLowerCase();
        const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
        const uname = (user.NomeUsuario || '').toLowerCase();
        const uemail = (user.Email || '').toLowerCase();
        if (uname === adminName || (adminEmail && uemail === adminEmail)) allow = true;
      }
    }
    if (!allow) return res.status(403).json({ error: 'forbidden' });

    // Use lowercase (unquoted) column names and alias to camelCase for JSON output so this works
    // regardless of whether the DB was created with unquoted identifiers (which fold to lowercase).
    const q = `SELECT id,
      sessionid AS "sessionId",
      userid AS "userId",
      questionid AS "questionId",
      startedat AS "startedAt",
      answeredat AS "answeredAt",
      totalms AS "totalMs",
      activems AS "activeMs",
      interruptions,
      firstresponsems AS "firstResponseMs",
      createdat AS "createdAt",
      updatedat AS "updatedAt"
      FROM response_times ORDER BY id DESC LIMIT :limit`;
    const rows = await db.sequelize.query(q, { replacements: { limit }, type: db.sequelize.QueryTypes.SELECT });
    return res.json({ ok: true, count: Array.isArray(rows) ? rows.length : 0, rows });
  } catch (err) {
    console.error('Erro debug response-times:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;

// Dev-only: send a test verification email (POST) - body: { to }
router.post('/send-test-email', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ message: 'Forbidden in production' });
    const to = (req.body && req.body.to) || req.query.to;
    if (!to) return res.status(400).json({ message: 'to (email) required' });

    const token = generateVerificationCode(6);
  const result = await sendVerificationEmail(to, token);
  // Return the raw result from the mailer for easier debugging in dev
  return res.json({ ok: true, mailer: result, token: result.token || token, verifyUrl: result.verifyUrl || null });
  } catch (err) {
    console.error('Erro send-test-email:', err);
    return res.status(500).json({ message: 'Erro enviando e-mail de teste' });
  }
});
