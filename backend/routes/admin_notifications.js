const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');

// Create draft notification
router.post('/', requireAdmin, async (req, res) => {
  try {
    // Debug log de entrada para diagnosticar 500 durante criação via HTTP
    console.log('[admin_notifications][CREATE][incoming]', {
      rawBodyKeys: Object.keys(req.body||{}),
      categoria: req.body && req.body.categoria,
      titulo: req.body && req.body.titulo,
      mensagemLen: req.body && req.body.mensagem ? req.body.mensagem.length : 0,
      targetType: req.body && req.body.targetType,
      targetUserId: req.body && req.body.targetUserId,
      hasUser: !!req.user,
      userId: req.user && (req.user.Id || req.user.id),
      headersAuth: req.headers.authorization,
      xSession: req.get('X-Session-Token')
    });
    const { categoria, titulo, mensagem, targetType, targetUserId } = req.body || {};
    if (!categoria || !titulo || !mensagem) return res.status(400).json({ error: 'Missing fields' });
    const validCat = ['Promocoes','Avisos','Alertas'];
    if (!validCat.includes(categoria)) return res.status(400).json({ error: 'Invalid categoria' });
    if (!req.user || !(req.user.Id || req.user.id)) {
      console.warn('[admin_notifications][CREATE] missing req.user');
      return res.status(401).json({ error: 'Admin identity missing' });
    }
    const nt = await db.Notification.create({
      categoria,
      titulo,
      mensagem,
      targetType: targetType === 'user' ? 'user' : 'all',
      targetUserId: targetType === 'user' ? Number(targetUserId) || null : null,
      status: 'draft',
      createdBy: Number(req.user.Id || req.user.id)
    });
    res.status(201).json(nt);
  } catch(e){
    const msg = e && (e.message || e.toString());
    const code = e && e.original && (e.original.code || e.original.errno);
    console.error('[admin_notifications][CREATE] error:', code, msg);
    res.status(500).json({ error: 'Internal error', code, message: msg });
  }
});

// Send notification (generate UserNotification rows)
router.post('/:id/send', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const n = await db.Notification.findByPk(id);
    if (!n) return res.status(404).json({ error: 'Not found' });
    if (n.status === 'sent') return res.status(409).json({ error: 'Already sent' });

    let targets = [];
    if (n.targetType === 'user' && n.targetUserId) {
      const u = await db.User.findByPk(n.targetUserId);
      if (!u) return res.status(400).json({ error: 'Target user not found' });
      targets = [u];
    } else {
      targets = await db.User.findAll({ attributes: ['Id'] });
    }
    const rows = targets.map(u => ({ notificationId: n.id, userId: u.Id || u.id, deliveryStatus: 'delivered', deliveredAt: new Date() }));
    if (rows.length) await db.UserNotification.bulkCreate(rows);
    n.status = 'sent'; await n.save();
    res.json({ sent: rows.length });
  } catch(e){
    const msg = e && (e.message || e.toString());
    const code = e && e.original && (e.original.code || e.original.errno);
    console.error('[admin_notifications][SEND] error:', code, msg);
    res.status(500).json({ error: 'Internal error', code, message: msg });
  }
});

// Admin list notifications
router.get('/', requireAdmin, async (req, res) => {
  try {
    const list = await db.Notification.findAll({ order: [['createdAt','DESC']], limit: 100 });
    res.json(list);
  } catch(e){
    // Log detalhes para troubleshooting (enum, tabela inexistente, perms, etc.)
    const msg = e && (e.message || e.toString());
    const code = e && e.original && (e.original.code || e.original.errno);
    console.error('[admin_notifications][LIST] error:', code, msg);
    res.status(500).json({ error: 'Internal error', code, message: msg });
  }
});

// Detail with stats
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const n = await db.Notification.findByPk(id);
    if (!n) return res.status(404).json({ error: 'Not found' });
    const total = await db.UserNotification.count({ where: { notificationId: id } });
    const read = await db.UserNotification.count({ where: { notificationId: id, readAt: { [db.Sequelize.Op.ne]: null } } });
    res.json({ notification: n, stats: { total, read } });
  } catch(e){
    const msg = e && (e.message || e.toString());
    const code = e && e.original && (e.original.code || e.original.errno);
    console.error('[admin_notifications][DETAIL] error:', code, msg);
    res.status(500).json({ error: 'Internal error', code, message: msg });
  }
});

module.exports = router;
