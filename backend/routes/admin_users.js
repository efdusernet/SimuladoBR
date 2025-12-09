const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');
const bcrypt = require('bcryptjs');

// GET /api/admin/users
// Lista usuários para seleção administrativa (Id, Nome, NomeUsuario)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const offset = parseInt(req.query.offset) || 0;
    const users = await db.User.findAll({
      attributes: ['Id', 'Nome', 'NomeUsuario'],
      limit,
      offset,
      order: [['Id', 'DESC']]
    });
    res.json(users);
  } catch (e) {
    console.error('[admin_users][LIST] error:', e && e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/admin/users/reset-password
 * Admin endpoint to reset any user's password by email
 * Body: { email, newPassword } where newPassword is SHA-256 hash from client
 */
router.post('/reset-password', requireAdmin, async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email e nova senha obrigatórios' });
    }

    const targetUser = await db.User.findOne({ 
      where: { Email: email.toLowerCase().trim() } 
    });
    
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuário não encontrado com este email' });
    }

    // newPassword is already SHA-256 hashed from client, now bcrypt it
    const bcryptHash = await bcrypt.hash(newPassword, 10);
    
    targetUser.SenhaHash = bcryptHash;
    targetUser.DataAlteracao = new Date();
    await targetUser.save();

    console.log(`[admin-reset-password] Admin user ${req.user.Id} reset password for user ${targetUser.Id} (${targetUser.Email})`);

    return res.json({ 
      message: 'Senha resetada com sucesso', 
      email: targetUser.Email,
      userId: targetUser.Id 
    });
  } catch (err) {
    console.error('[admin_users][RESET_PASSWORD] error:', err);
    return res.status(500).json({ error: 'Erro interno ao resetar senha' });
  }
});

module.exports = router;