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

module.exports = router;

// Dev-only: send a test verification email (POST) - body: { to }
router.post('/send-test-email', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ message: 'Forbidden in production' });
    const to = (req.body && req.body.to) || req.query.to;
    if (!to) return res.status(400).json({ message: 'to (email) required' });

    const token = generateVerificationCode(6).toUpperCase();
  const result = await sendVerificationEmail(to, token);
  // Return the raw result from the mailer for easier debugging in dev
  return res.json({ ok: true, mailer: result, token: result.token || token, verifyUrl: result.verifyUrl || null });
  } catch (err) {
    console.error('Erro send-test-email:', err);
    return res.status(500).json({ message: 'Erro enviando e-mail de teste' });
  }
});
