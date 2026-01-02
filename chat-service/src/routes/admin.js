const express = require('express');
const { randomUUID } = require('crypto');

const { adminAuth } = require('../middleware/adminAuth');
const { conversationsStore } = require('../store/conversationsStore');
const { messagesStore } = require('../store/messagesStore');
const { adminUsersStore } = require('../store/adminUsersStore');
const { supportTopicsStore } = require('../store/supportTopicsStore');
const { generateAdminToken, hashAdminToken, encryptAdminToken, decryptAdminToken } = require('../services/adminTokens');
const { isSmtpConfigured, sendInviteEmail } = require('../services/mailer');
const { emitAdminRefresh } = require('../realtime/adminEvents');

const adminRouter = express.Router();

adminRouter.use(adminAuth());

adminRouter.get('/me', async (req, res, next) => {
  try {
    const role = req.admin && req.admin.role ? String(req.admin.role) : (req.admin && req.admin.id ? 'attendant' : 'root');
    const isRoot = role === 'root';
    res.json({
      ok: true,
      id: req.admin && req.admin.id ? String(req.admin.id) : null,
      name: req.admin && req.admin.name ? String(req.admin.name) : 'Root',
      isRoot,
      role,
    });
  } catch (err) {
    next(err);
  }
});

function requireAdminOrRoot(req) {
  const role = req.admin && req.admin.role ? String(req.admin.role) : (req.admin && req.admin.id ? 'attendant' : 'root');
  return role === 'root' || role === 'admin';
}

function isValidEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return Boolean(e && e.includes('@') && e.length <= 320);
}

function tokenHint(rawToken) {
  const t = String(rawToken || '');
  return t.length >= 4 ? t.slice(-4) : t;
}

function parseEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (!e) return '';
  if (!e.includes('@') || e.length > 320) return '';
  return e;
}

function parseTopicTitle(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t.length > 120) return '';
  return t;
}

function parseTopicMessageText(raw, fallbackTitle) {
  const t = String(raw || '').trim();
  const out = t || String(fallbackTitle || '').trim();
  if (!out) return '';
  if (out.length > 2000) return '';
  return out;
}

function parseTopicAutoReplyText(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (t.length > 2000) return '';
  return t;
}

function parseSortOrder(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

adminRouter.post('/invites', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode criar convites');
      e.status = 403;
      throw e;
    }

    const invites = Array.isArray(req.body && req.body.invites) ? req.body.invites : [];
    if (invites.length < 1) {
      const e = new Error('invites obrigatório');
      e.status = 400;
      throw e;
    }
    if (invites.length > 50) {
      const e = new Error('Muitos convites de uma vez (máx 50)');
      e.status = 400;
      throw e;
    }

    const results = [];
    const apiBase = req.body && req.body.apiBase != null ? String(req.body.apiBase).trim() : '';
    const smtpEnabled = isSmtpConfigured();
    for (const invite of invites) {
      const email = invite && invite.email != null ? String(invite.email).trim().toLowerCase() : '';
      const role = invite && invite.role != null ? String(invite.role) : 'attendant';
      const name = invite && invite.name != null ? String(invite.name).trim() : '';

      if (!isValidEmail(email)) {
        results.push({ ok: false, email, error: 'INVALID_EMAIL' });
        continue;
      }
      if (!['admin', 'attendant'].includes(role)) {
        results.push({ ok: false, email, error: 'INVALID_ROLE' });
        continue;
      }

      const rawToken = generateAdminToken();
      const tokenHash = hashAdminToken(rawToken);
      const tokenEncrypted = encryptAdminToken(rawToken);

      const user = await adminUsersStore.upsertInvite({
        email,
        role,
        name: name || email,
        tokenHash,
        tokenEncrypted,
      });

      let sent = false;
      let emailError = null;
      let messageId = null;
      if (smtpEnabled) {
        try {
          const info = await sendInviteEmail({ to: email, role: String(user.role || role), token: rawToken, apiBase });
          sent = true;
          messageId = info && info.messageId ? String(info.messageId) : null;
        } catch (err) {
          sent = false;
          emailError = err && err.code ? String(err.code) : (err && err.message ? String(err.message) : 'EMAIL_SEND_FAILED');
        }
      } else {
        emailError = 'SMTP_NOT_CONFIGURED';
      }

      // Security: only return the plaintext token when SMTP is NOT configured or when sending failed.
      // This avoids leaking tokens via logs/proxies when email delivery succeeded.
      const includeToken = !smtpEnabled || !sent;
      const out = { ok: true, email, role: String(user.role || role), id: String(user.id), sent, messageId, emailError, tokenHint: tokenHint(rawToken) };
      if (includeToken) out.token = rawToken;
      results.push(out);
    }

    res.json({ ok: true, smtpEnabled, results });
  } catch (err) {
    next(err);
  }
});

// Support topics (admin CRUD)
adminRouter.get('/support-topics', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode gerenciar assuntos');
      e.status = 403;
      throw e;
    }
    const topics = await supportTopicsStore.listAdmin({ limit: 500 });
    res.json({ ok: true, topics });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/support-topics', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode criar assuntos');
      e.status = 403;
      throw e;
    }

    const title = parseTopicTitle(req.body && req.body.title != null ? req.body.title : '');
    if (!title) {
      const e = new Error('title inválido');
      e.status = 400;
      throw e;
    }
    const messageText = parseTopicMessageText(req.body && req.body.messageText != null ? req.body.messageText : '', title);
    if (!messageText) {
      const e = new Error('messageText inválido');
      e.status = 400;
      throw e;
    }

    const autoReplyText = req.body && req.body.autoReplyText != null
      ? parseTopicAutoReplyText(req.body.autoReplyText)
      : null;
    if (autoReplyText === '') {
      const e = new Error('autoReplyText inválido');
      e.status = 400;
      throw e;
    }
    const sortOrder = parseSortOrder(req.body && req.body.sortOrder != null ? req.body.sortOrder : 0);
    const active = req.body && req.body.active != null ? Boolean(req.body.active) : true;

    const topic = await supportTopicsStore.create({ title, messageText, autoReplyText, active, sortOrder });
    res.json({ ok: true, topic });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/support-topics/:id', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode editar assuntos');
      e.status = 403;
      throw e;
    }

    const id = String(req.params.id);
    const title = req.body && req.body.title != null ? parseTopicTitle(req.body.title) : null;
    if (title !== null && !title) {
      const e = new Error('title inválido');
      e.status = 400;
      throw e;
    }
    const messageText = req.body && req.body.messageText != null ? String(req.body.messageText) : null;
    if (messageText !== null && String(messageText).trim().length > 2000) {
      const e = new Error('messageText inválido');
      e.status = 400;
      throw e;
    }

    const autoReplyText = req.body && req.body.autoReplyText != null ? String(req.body.autoReplyText) : null;
    if (autoReplyText !== null && String(autoReplyText).trim().length > 2000) {
      const e = new Error('autoReplyText inválido');
      e.status = 400;
      throw e;
    }
    const active = req.body && req.body.active != null ? Boolean(req.body.active) : null;
    const sortOrder = req.body && req.body.sortOrder != null ? parseSortOrder(req.body.sortOrder) : null;

    const updated = await supportTopicsStore.update(id, { title, messageText, autoReplyText, active, sortOrder });
    if (!updated) {
      const e = new Error('Assunto não encontrado');
      e.status = 404;
      throw e;
    }
    res.json({ ok: true, topic: updated });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/support-topics/:id', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode remover assuntos');
      e.status = 403;
      throw e;
    }
    const id = String(req.params.id);
    await supportTopicsStore.remove(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/invites/resend', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode reenviar convites');
      e.status = 403;
      throw e;
    }

    const email = req.body && req.body.email != null ? String(req.body.email).trim().toLowerCase() : '';
    if (!isValidEmail(email)) {
      const e = new Error('email inválido');
      e.status = 400;
      throw e;
    }

    const existing = await adminUsersStore.getByEmail(email);
    if (!existing) {
      const e = new Error('Usuário não encontrado para este email');
      e.status = 404;
      throw e;
    }

    const rawToken = generateAdminToken();
    const tokenHash = hashAdminToken(rawToken);
    const tokenEncrypted = encryptAdminToken(rawToken);
    const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const updated = await adminUsersStore.updateTokenHash(String(existing.id), tokenHash, tokenEncrypted, tokenExpiresAt);

    const apiBase = req.body && req.body.apiBase != null ? String(req.body.apiBase).trim() : '';
    const smtpEnabled = isSmtpConfigured();

    let sent = false;
    let emailError = null;
    let messageId = null;
    if (smtpEnabled) {
      try {
        const info = await sendInviteEmail({ to: email, role: String(updated.role || existing.role || 'attendant'), token: rawToken, apiBase });
        sent = true;
        messageId = info && info.messageId ? String(info.messageId) : null;
      } catch (err) {
        sent = false;
        emailError = err && err.code ? String(err.code) : (err && err.message ? String(err.message) : 'EMAIL_SEND_FAILED');
      }
    } else {
      emailError = 'SMTP_NOT_CONFIGURED';
    }

    const includeToken = !smtpEnabled || !sent;
    const result = {
      ok: true,
      email,
      role: String(updated.role || existing.role || 'attendant'),
      id: String(updated.id || existing.id),
      sent,
      messageId,
      emailError,
      tokenHint: tokenHint(rawToken),
    };
    if (includeToken) result.token = rawToken;

    res.json({ ok: true, smtpEnabled, result });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/attendants', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode listar atendentes');
      e.status = 403;
      throw e;
    }
    const attendants = await adminUsersStore.list({ limit: 200 });
    res.json({ ok: true, attendants });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/attendants/tokens', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode listar tokens');
      e.status = 403;
      throw e;
    }

    const attendants = await adminUsersStore.listWithEncryptedTokens({ limit: 500 });
    const out = attendants.map((a) => {
      let token = null;
      try {
        token = a.token_encrypted ? decryptAdminToken(String(a.token_encrypted)) : null;
      } catch {
        token = null;
      }
      return {
        id: String(a.id),
        name: String(a.name),
        role: String(a.role || 'attendant'),
        active: Boolean(a.active),
        createdAt: a.created_at,
        token,
        hasToken: Boolean(a.token_encrypted),
      };
    });

    res.json({ ok: true, attendants: out });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/attendants', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode criar atendentes');
      e.status = 403;
      throw e;
    }
    const email = parseEmail(req.body && req.body.email != null ? req.body.email : '');
    if (!email) {
      const e = new Error('email inválido');
      e.status = 400;
      throw e;
    }

    const name = req.body && req.body.name != null ? String(req.body.name).trim() : '';
    const finalName = name || email;

    const rawToken = generateAdminToken();
    const tokenHash = hashAdminToken(rawToken);
    const tokenEncrypted = encryptAdminToken(rawToken);

    const id = randomUUID();
    const createdAt = new Date();

    await adminUsersStore.insert({ id, name: finalName, email, tokenHash, tokenEncrypted, createdAt, active: true, role: 'attendant' });

    // Return raw token once so the UI can show/copy it.
    res.json({ ok: true, attendant: { id, name: finalName, email, active: true, createdAt }, token: rawToken });
  } catch (err) {
    if (err && err.code === '23505') {
      // Unique violation (email)
      const e = new Error('Email já cadastrado');
      e.status = 409;
      return next(e);
    }
    next(err);
  }
});

adminRouter.post('/admins', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode criar admins');
      e.status = 403;
      throw e;
    }

    const email = parseEmail(req.body && req.body.email != null ? req.body.email : '');
    if (!email) {
      const e = new Error('email inválido');
      e.status = 400;
      throw e;
    }

    const name = req.body && req.body.name != null ? String(req.body.name).trim() : '';
    const finalName = name || email;

    const rawToken = generateAdminToken();
    const tokenHash = hashAdminToken(rawToken);
    const tokenEncrypted = encryptAdminToken(rawToken);

    const id = randomUUID();
    const createdAt = new Date();

    await adminUsersStore.insert({ id, name: finalName, email, tokenHash, tokenEncrypted, createdAt, active: true, role: 'admin' });

    res.json({ ok: true, admin: { id, name: finalName, email, role: 'admin', active: true, createdAt }, token: rawToken });
  } catch (err) {
    if (err && err.code === '23505') {
      const e = new Error('Email já cadastrado');
      e.status = 409;
      return next(e);
    }
    next(err);
  }
});

adminRouter.post('/attendants/:id/deactivate', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode desativar atendentes');
      e.status = 403;
      throw e;
    }
    const id = String(req.params.id);
    await adminUsersStore.deactivate(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/attendants/:id/reset-token', async (req, res, next) => {
  try {
    const id = String(req.params.id);

    // Admin/root only: attendants should not be able to rotate other attendants' tokens.
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode resetar token de atendente');
      e.status = 403;
      throw e;
    }

    const existing = await adminUsersStore.getById(id);
    if (!existing) {
      const e = new Error('Atendente não encontrado');
      e.status = 404;
      throw e;
    }

    const rawToken = generateAdminToken();
    const tokenHash = hashAdminToken(rawToken);
    const tokenEncrypted = encryptAdminToken(rawToken);

    const updated = await adminUsersStore.updateTokenHash(id, tokenHash, tokenEncrypted);
    res.json({ ok: true, attendant: updated, token: rawToken });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/attendants/:id', async (req, res, next) => {
  try {
    if (!requireAdminOrRoot(req)) {
      const e = new Error('Apenas admin/root pode excluir atendentes');
      e.status = 403;
      throw e;
    }
    const id = String(req.params.id);
    await adminUsersStore.remove(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/conversations', async (req, res, next) => {
  try {
    const status = req.query && req.query.status ? String(req.query.status) : 'open';
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 50;

    const conversations = await conversationsStore.listRecent({ status, limit });
    res.json({ ok: true, conversations });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);

    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    let assignedAdmin = null;
    if (conversation.assigned_admin_user_id) {
      assignedAdmin = await adminUsersStore.getById(String(conversation.assigned_admin_user_id));
      if (assignedAdmin) {
        assignedAdmin = { id: String(assignedAdmin.id), name: String(assignedAdmin.name) };
      } else {
        assignedAdmin = { id: String(conversation.assigned_admin_user_id), name: null };
      }
    }

    const messages = await messagesStore.listByConversationId(conversationId);
    res.json({
      ok: true,
      conversationId,
      conversation: {
        id: String(conversation.id),
        visitorId: String(conversation.visitor_id),
        userId: conversation.user_id != null ? String(conversation.user_id) : null,
        customerName: conversation.customer_name != null ? String(conversation.customer_name) : null,
        status: String(conversation.status),
        origin: String(conversation.origin),
        createdAt: conversation.created_at,
        assignedAdminUserId: conversation.assigned_admin_user_id ? String(conversation.assigned_admin_user_id) : null,
        assignedAt: conversation.assigned_at || null,
        assignedAdmin,
      },
      messages,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/conversations/:conversationId/customer-name', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);
    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const role = req.admin && req.admin.role ? String(req.admin.role) : (req.admin && req.admin.id ? 'attendant' : 'root');
    const adminUserId = req.admin && req.admin.id ? String(req.admin.id) : null;
    const isAdminOrRoot = role === 'root' || role === 'admin';

    // Attendants can rename only if the conversation is free or assigned to themselves.
    if (!isAdminOrRoot) {
      if (!adminUserId) {
        const e = new Error('Sem permissão');
        e.status = 403;
        throw e;
      }

      const assigned = conversation.assigned_admin_user_id ? String(conversation.assigned_admin_user_id) : '';
      if (assigned && assigned !== String(adminUserId)) {
        const e = new Error('Você não pode renomear uma conversa atribuída a outro atendente');
        e.status = 403;
        throw e;
      }
    }

    const name = req.body && req.body.name != null ? String(req.body.name).trim() : '';
    if (name.length > 120) {
      const e = new Error('Nome muito longo (máx 120)');
      e.status = 400;
      throw e;
    }

    const updated = await conversationsStore.setCustomerName({ conversationId, customerName: name });
    emitAdminRefresh({ reason: 'conversation_renamed', conversationId });
    res.json({ ok: true, conversationId, customerName: updated && updated.customer_name != null ? String(updated.customer_name) : null });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/conversations/:conversationId/claim', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);
    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const adminUserId = req.admin && req.admin.id ? String(req.admin.id) : '';
    if (!adminUserId) {
      const e = new Error('Token root não pode assumir conversa. Use um token de atendente.');
      e.status = 400;
      throw e;
    }

    const force = (req.query && (String(req.query.force || '').toLowerCase() === '1' || String(req.query.force || '').toLowerCase() === 'true'));

    if (conversation.assigned_admin_user_id) {
      // Admin/root can force-transfer (attendants cannot).
      if (force && requireAdminOrRoot(req)) {
        const assigned = await conversationsStore.assign({ conversationId, adminUserId, assignedAt: new Date() });
        emitAdminRefresh({ reason: 'conversation_assigned', conversationId });
        res.json({ ok: true, conversationId, assignedAdminUserId: String(adminUserId), forced: true, conversation: assigned });
        return;
      }

      const assignedTo = await adminUsersStore.getById(String(conversation.assigned_admin_user_id));
      const e = new Error('Conversa já está atribuída a outro atendente');
      e.status = 409;
      e.details = { assignedTo: assignedTo ? { id: String(assignedTo.id), name: String(assignedTo.name) } : { id: String(conversation.assigned_admin_user_id), name: null } };
      throw e;
    }

    const claimed = await conversationsStore.claim({ conversationId, adminUserId, claimedAt: new Date() });
    if (!claimed) {
      const current = await conversationsStore.getById(conversationId);
      const assigned = current && current.assigned_admin_user_id ? await adminUsersStore.getById(String(current.assigned_admin_user_id)) : null;
      const e = new Error('Conversa já está atribuída a outro atendente');
      e.status = 409;
      e.details = { assignedTo: assigned ? { id: String(assigned.id), name: String(assigned.name) } : (current && current.assigned_admin_user_id ? { id: String(current.assigned_admin_user_id), name: null } : null) };
      throw e;
    }

    emitAdminRefresh({ reason: 'conversation_claimed', conversationId });
    res.json({ ok: true, conversationId, assignedAdminUserId: String(adminUserId) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/conversations/:conversationId/release', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);
    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const adminUserId = req.admin && req.admin.id ? String(req.admin.id) : null;
    const isRoot = !adminUserId;

    if (!conversation.assigned_admin_user_id) {
      res.json({ ok: true, conversationId, released: false });
      return;
    }

    if (!isRoot && String(conversation.assigned_admin_user_id) !== String(adminUserId)) {
      const e = new Error('Você não pode liberar uma conversa atribuída a outro atendente');
      e.status = 403;
      throw e;
    }

    const released = await conversationsStore.release({ conversationId, adminUserId: isRoot ? null : adminUserId });
    if (released) emitAdminRefresh({ reason: 'conversation_released', conversationId });
    res.json({ ok: true, conversationId, released: Boolean(released) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);

    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    if (String(conversation.status || 'open') !== 'open') {
      const e = new Error('Conversa encerrada');
      e.status = 409;
      throw e;
    }

    const text = req.body && req.body.text != null ? String(req.body.text).trim() : '';
    if (!text) {
      const e = new Error('text obrigatório');
      e.status = 400;
      throw e;
    }

    const adminUserId = req.admin && req.admin.id ? String(req.admin.id) : null;
    const isRoot = !adminUserId;

    // Enforce exclusive replying: everyone can read, only assignee can reply.
    if (conversation.assigned_admin_user_id) {
      if (!isRoot && String(conversation.assigned_admin_user_id) !== String(adminUserId)) {
        const assigned = await adminUsersStore.getById(String(conversation.assigned_admin_user_id));
        const e = new Error('Conversa atribuída a outro atendente');
        e.status = 403;
        e.details = { assignedTo: assigned ? { id: String(assigned.id), name: String(assigned.name) } : { id: String(conversation.assigned_admin_user_id), name: null } };
        throw e;
      }
    } else {
      // Auto-claim on first reply (attendant tokens only).
      if (!isRoot) {
        const claimed = await conversationsStore.claim({ conversationId, adminUserId, claimedAt: new Date() });
        if (!claimed) {
          const current = await conversationsStore.getById(conversationId);
          const assigned = current && current.assigned_admin_user_id ? await adminUsersStore.getById(String(current.assigned_admin_user_id)) : null;
          const e = new Error('Conversa atribuída a outro atendente');
          e.status = 403;
          e.details = { assignedTo: assigned ? { id: String(assigned.id), name: String(assigned.name) } : (current && current.assigned_admin_user_id ? { id: String(current.assigned_admin_user_id), name: null } : null) };
          throw e;
        }
      }
    }

    const messageId = randomUUID();
    const createdAt = new Date();

    const senderName = req.admin && req.admin.name ? String(req.admin.name) : null;

    await messagesStore.insert({
      id: messageId,
      conversationId,
      createdAt,
      role: 'agent',
      text,
      senderName,
    });

    emitAdminRefresh({ reason: 'agent_message', conversationId });

    res.json({ ok: true, message: { id: messageId, conversationId, createdAt, role: 'agent', text, senderName } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/conversations/:conversationId/close', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const conversation = await conversationsStore.getById(conversationId);

    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const role = req.admin && req.admin.role ? String(req.admin.role) : (req.admin && req.admin.id ? 'attendant' : 'root');
    const adminUserId = req.admin && req.admin.id ? String(req.admin.id) : null;
    const isAdminOrRoot = role === 'root' || role === 'admin';

    // Attendants can only close conversations assigned to themselves.
    if (!isAdminOrRoot) {
      if (!adminUserId) {
        const e = new Error('Sem permissão');
        e.status = 403;
        throw e;
      }
      if (!conversation.assigned_admin_user_id || String(conversation.assigned_admin_user_id) !== String(adminUserId)) {
        const e = new Error('Você só pode encerrar conversas atribuídas a você');
        e.status = 403;
        throw e;
      }
    }

    if (String(conversation.status || 'open') !== 'open') {
      res.json({ ok: true, conversationId, closed: false, status: String(conversation.status) });
      return;
    }

    await conversationsStore.close({ conversationId, closedAt: new Date() });
    emitAdminRefresh({ reason: 'conversation_closed', conversationId });
    res.json({ ok: true, conversationId, closed: true, status: 'closed' });
  } catch (err) {
    next(err);
  }
});

module.exports = { adminRouter };
