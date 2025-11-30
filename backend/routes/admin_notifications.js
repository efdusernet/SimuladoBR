const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');

// Create draft notification
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { categoria, titulo, mensagem, targetType, targetUserId } = req.body || {};
    if (!categoria || !titulo || !mensagem) return res.status(400).json({ error: 'Missing fields' });
    const validCat = ['Promocoes','Avisos','Alertas'];
    if (!validCat.includes(categoria)) return res.status(400).json({ error: 'Invalid categoria' });
    const nt = await db.Notification.create({
      categoria,
      titulo,
      mensagem,
      targetType: targetType === 'user' ? 'user' : 'all',
      targetUserId: targetType === 'user' ? Number(targetUserId) || null : null,
      status: 'draft',
      createdBy: req.user.Id || req.user.id
    });
    res.status(201).json(nt);
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
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
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
});

// Admin list notifications
router.get('/', requireAdmin, async (req, res) => {
  try {
    const list = await db.Notification.findAll({ order: [['createdAt','DESC']], limit: 100 });
    res.json(list);
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
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
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
});

module.exports = router;
