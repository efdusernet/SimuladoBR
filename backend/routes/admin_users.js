const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');

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

module.exports = router;