const express = require('express');
const router = express.Router();
const db = require('../models');
const crypto = require('crypto');
const { generateVerificationCode } = require('../utils/codegen');
const { sendVerificationEmail } = require('../utils/mailer');
const { badRequest, forbidden, internalError } = require('../middleware/errors');

// Dev-only endpoint: retorna o usuário atual do Postgres e variáveis relevantes
router.get('/db-user', async (req, res, next) => {
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
    return next(internalError('Erro ao consultar DB', 'DEBUG_DB_USER_ERROR', err));
  }
});

module.exports = router;

// Dev-only: send a test verification email (POST) - body: { to }
router.post('/send-test-email', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') return next(forbidden('Forbidden in production', 'FORBIDDEN_IN_PRODUCTION'));
    const to = (req.body && req.body.to) || req.query.to;
    if (!to) return next(badRequest('to (email) required', 'EMAIL_TO_REQUIRED'));

    const token = generateVerificationCode(6).toUpperCase();
  const result = await sendVerificationEmail(to, token);
  // Return the raw result from the mailer for easier debugging in dev
  return res.json({ ok: true, mailer: result, token: result.token || token, verifyUrl: result.verifyUrl || null });
  } catch (err) {
    console.error('Erro send-test-email:', err);
    return next(internalError('Erro enviando e-mail de teste', 'DEBUG_SEND_TEST_EMAIL_ERROR', err));
  }
});
