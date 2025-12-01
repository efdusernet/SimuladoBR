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
    if (!req.user || !(req.user.Id || req.user.id)) {
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
    console.error('[admin_notifications][CREATE] error:', e && e.message);
    res.status(500).json({ error: 'Internal error' });
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
    // Ordena por id DESC para evitar dependência de alias createdAt (coluna é createdat no schema)
    const list = await db.Notification.findAll({ order: [['id','DESC']], limit: 100 });
    // Enriquecer com Nome (Usuario) quando targetType=user
    const userIds = Array.from(new Set(list
      .filter(n => n && n.targetType === 'user' && n.targetUserId)
      .map(n => Number(n.targetUserId))
      .filter(id => Number.isFinite(id))
    ));
    let usersById = {};
    if (userIds.length) {
      const users = await db.User.findAll({
        attributes: ['Id','Nome','NomeUsuario'],
        where: { Id: userIds }
      });
      users.forEach(u => { usersById[Number(u.Id)] = { Id: u.Id, Nome: u.Nome, NomeUsuario: u.NomeUsuario }; });
    }
    const enriched = list.map(n => {
      const plain = n.toJSON();
      if (plain.targetType === 'user' && plain.targetUserId) {
        const u = usersById[Number(plain.targetUserId)];
        if (u) {
          plain.targetUser = {
            Id: u.Id,
            Nome: u.Nome,
            NomeUsuario: u.NomeUsuario,
            display: `${(u.Nome||u.NomeUsuario||'Usuario')} - ${u.Id}`
          };
        }
      }
      return plain;
    });
    res.json(enriched);
  } catch(e){
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
