const express = require('express');
const router = express.Router();
const db = require('../models');
const requireUserSession = require('../middleware/requireUserSession');

// List notifications for current user
router.get('/', requireUserSession, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Number(req.query.limit)||20, 100);
    const list = await db.UserNotification.findAll({
      where: { userId },
      order: [['createdAt','DESC']],
      limit
    });
    // Join with Notification minimal fields
    const ids = list.map(x => x.notificationId);
    const notifMap = {};
    if (ids.length){
      const ns = await db.Notification.findAll({ where: { id: ids } });
      ns.forEach(n => { notifMap[n.id] = { categoria: n.categoria, titulo: n.titulo, mensagem: n.mensagem, createdAt: n.createdAt }; });
    }
    const out = list.map(r => ({ id: r.id, notificationId: r.notificationId, readAt: r.readAt, deliveredAt: r.deliveredAt, categoria: notifMap[r.notificationId]?.categoria, titulo: notifMap[r.notificationId]?.titulo, mensagem: notifMap[r.notificationId]?.mensagem, createdAt: notifMap[r.notificationId]?.createdAt }));
    res.json(out);
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
});

// Unread count
router.get('/unread-count', requireUserSession, async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await db.UserNotification.count({ where: { userId, readAt: null } });
    res.json({ count });
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
});

// Mark read
router.post('/:id/read', requireUserSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await db.UserNotification.findByPk(id);
    if (!row || (row.userId !== req.user.id)) return res.status(404).json({ error: 'Not found' });
    if (!row.readAt) { row.readAt = new Date(); await row.save(); }
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: 'Internal error' }); }
});

module.exports = router;
