const express = require('express');
const { randomUUID } = require('crypto');

const { visitorsStore } = require('../store/visitorsStore');
const { conversationsStore } = require('../store/conversationsStore');
const { messagesStore } = require('../store/messagesStore');
const { supportTopicsStore } = require('../store/supportTopicsStore');
const { emitAdminRefresh } = require('../realtime/adminEvents');
const { notifySupportContact } = require('../services/supportContactNotifier');

const conversationsRouter = express.Router();

// Public: list active support topics (quick options shown in widget)
conversationsRouter.get('/support-topics', async (req, res, next) => {
  try {
    const topics = await supportTopicsStore.listPublic();
    res.json({ ok: true, topics });
  } catch (err) {
    next(err);
  }
});

function getVisitorIdFromRequest(req) {
  const header = req.headers['x-chat-visitor-id'];
  if (header) return String(header).trim();
  const bodyVisitor = req.body && req.body.visitorId ? String(req.body.visitorId).trim() : '';
  return bodyVisitor || '';
}

function getCustomerNameFromRequest(req) {
  const raw = req.body && (req.body.customerName ?? req.body.customer_name);
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > 120) return s.slice(0, 120);
  return s;
}

conversationsRouter.post('/conversations', async (req, res, next) => {
  try {
    const now = new Date();
    const requestVisitorId = getVisitorIdFromRequest(req);
    const customerName = getCustomerNameFromRequest(req);

    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : null;

    let visitorId = requestVisitorId;
    if (!visitorId) {
      visitorId = randomUUID();
      await visitorsStore.insert({ id: visitorId, createdAt: now, userId });
    } else {
      // ensure it exists (idempotent)
      await visitorsStore.ensureExists({ id: visitorId, createdAt: now, userId });
    }

    const conversationId = randomUUID();
    await conversationsStore.insert({
      id: conversationId,
      visitorId,
      userId,
      createdAt: now,
      status: 'open',
      origin: 'widget',
      customerName,
    });

    emitAdminRefresh({ reason: 'conversation_created', conversationId });

    res.json({ ok: true, conversationId, visitorId });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post('/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorId = getVisitorIdFromRequest(req);
    const customerName = getCustomerNameFromRequest(req);
    if (!visitorId) {
      const e = new Error('X-Chat-Visitor-Id obrigatório');
      e.status = 400;
      throw e;
    }

    const text = req.body && req.body.text != null ? String(req.body.text).trim() : '';
    if (!text) {
      const e = new Error('text obrigatório');
      e.status = 400;
      throw e;
    }

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

    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : null;

    const visitorMatches = String(conversation.visitor_id) === visitorId;
    const userMatches = userId && conversation.user_id && String(conversation.user_id) === userId;

    if (!visitorMatches && !userMatches) {
      const e = new Error('Sem permissão para acessar esta conversa');
      e.status = 403;
      throw e;
    }

    if (customerName && !conversation.customer_name) {
      await conversationsStore.setCustomerName({ conversationId, customerName });
    }

    const messageId = randomUUID();
    const createdAt = new Date();

    const role = req.body && req.body.role ? String(req.body.role) : 'user';

    await messagesStore.insert({
      id: messageId,
      conversationId,
      createdAt,
      role,
      text,
    });

    emitAdminRefresh({ reason: 'user_message', conversationId });

    // Fire-and-forget: notify recipients when user clicks "Falar com Suporte".
    // We only trigger when the widget sends a supportTopicId that resolves to that exact title.
    try {
      const supportTopicId = req.body && (req.body.supportTopicId ?? req.body.support_topic_id);
      if (role === 'user' && supportTopicId != null) {
        const topic = await supportTopicsStore.getById(String(supportTopicId));
        const title = topic && topic.title != null ? String(topic.title) : '';
        if (title && title.trim().toLowerCase() === 'falar com suporte') {
          const effectiveUserName = (conversation && conversation.customer_name) ? String(conversation.customer_name) : (customerName ? String(customerName) : '');
          setTimeout(() => {
            notifySupportContact({
              supportTopicTitle: title,
              userName: effectiveUserName,
              messageCreatedAt: createdAt,
            }).catch((e) => {
              try { console.warn('[supportContactNotifier] failed:', e && e.message ? e.message : e); } catch (_) {}
            });
          }, 0);
        }
      }
    } catch (e) {
      // Never fail the user message flow.
      try { console.warn('[supportContactNotifier] skipped due to error:', e && e.message ? e.message : e); } catch (_) {}
    }

    res.json({ ok: true, message: { id: messageId, conversationId, createdAt, role, text } });
  } catch (err) {
    next(err);
  }
});

// Public: set/update customer name for the current conversation (widget)
conversationsRouter.post('/conversations/:conversationId/customer-name', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorId = getVisitorIdFromRequest(req);
    if (!visitorId) {
      const e = new Error('X-Chat-Visitor-Id obrigatório');
      e.status = 400;
      throw e;
    }

    const customerName = getCustomerNameFromRequest(req);
    if (!customerName) {
      const e = new Error('customerName obrigatório');
      e.status = 400;
      throw e;
    }

    const conversation = await conversationsStore.getById(conversationId);
    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : null;
    const visitorMatches = String(conversation.visitor_id) === visitorId;
    const userMatches = userId && conversation.user_id && String(conversation.user_id) === userId;
    if (!visitorMatches && !userMatches) {
      const e = new Error('Sem permissão para acessar esta conversa');
      e.status = 403;
      throw e;
    }

    const updated = await conversationsStore.setCustomerName({ conversationId, customerName });
    emitAdminRefresh({ reason: 'customer_name_updated', conversationId });
    res.json({ ok: true, conversationId, customerName: updated ? updated.customer_name : customerName });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post('/conversations/:conversationId/close', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorId = String(req.headers['x-chat-visitor-id'] || '').trim();

    if (!visitorId) {
      const e = new Error('X-Chat-Visitor-Id obrigatório');
      e.status = 400;
      throw e;
    }

    const conversation = await conversationsStore.getById(conversationId);
    if (!conversation) {
      const e = new Error('Conversa não encontrada');
      e.status = 404;
      throw e;
    }

    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : null;

    const visitorMatches = String(conversation.visitor_id) === visitorId;
    const userMatches = userId && conversation.user_id && String(conversation.user_id) === userId;

    if (!visitorMatches && !userMatches) {
      const e = new Error('Sem permissão para acessar esta conversa');
      e.status = 403;
      throw e;
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

conversationsRouter.get('/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorId = String(req.headers['x-chat-visitor-id'] || '').trim();

    if (!visitorId) {
      const e = new Error('X-Chat-Visitor-Id obrigatório');
      e.status = 400;
      throw e;
    }

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

    const userId = req.auth && req.auth.userId ? String(req.auth.userId) : null;

    const visitorMatches = String(conversation.visitor_id) === visitorId;
    const userMatches = userId && conversation.user_id && String(conversation.user_id) === userId;

    if (!visitorMatches && !userMatches) {
      const e = new Error('Sem permissão para acessar esta conversa');
      e.status = 403;
      throw e;
    }

    const messages = await messagesStore.listByConversationId(conversationId);
    res.json({ ok: true, conversationId, messages });
  } catch (err) {
    next(err);
  }
});

module.exports = { conversationsRouter };
