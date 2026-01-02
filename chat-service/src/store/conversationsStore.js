const { query } = require('../db/pool');

const conversationsStore = {
  async insert({ id, visitorId, userId, createdAt, status, origin, customerName = null }) {
    const name = customerName != null ? String(customerName).trim() : '';
    const finalName = name ? name.slice(0, 120) : null;
    await query(
      'INSERT INTO conversations (id, visitor_id, user_id, created_at, status, origin, customer_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, visitorId, userId, createdAt, status, origin, finalName]
    );
  },

  async listRecent({ status = 'open', limit = 50 } = {}) {
    const finalLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const wantStatus = String(status || 'open').trim().toLowerCase();
    const filterStatus = (wantStatus === 'all' || wantStatus === '*') ? null : wantStatus;

    const r = await query(
      `
      SELECT
        c.id,
        c.visitor_id,
        c.user_id,
        c.customer_name,
        c.status,
        c.origin,
        c.created_at,
        c.assigned_admin_user_id,
        c.assigned_at,
        au.name AS assigned_admin_name,
        lm.created_at AS last_message_at,
        lm.text AS last_message_text,
        lm.role AS last_message_role
      FROM conversations c
      LEFT JOIN admin_users au ON au.id = c.assigned_admin_user_id
      LEFT JOIN LATERAL (
        SELECT m.created_at, m.text, m.role
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE ($1::text IS NULL OR c.status = $1)
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC
      LIMIT $2
      `,
      [filterStatus, finalLimit]
    );

    return r.rows;
  },

  async setCustomerName({ conversationId, customerName }) {
    const name = customerName != null ? String(customerName).trim() : '';
    const finalName = name ? name : null;

    const r = await query(
      `
      UPDATE conversations
      SET customer_name = $2
      WHERE id = $1
      RETURNING *
      `,
      [conversationId, finalName]
    );
    return r.rows[0] || null;
  },

  async getById(id) {
    const r = await query('SELECT * FROM conversations WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async claim({ conversationId, adminUserId, claimedAt = new Date() }) {
    const r = await query(
      `
      UPDATE conversations
      SET assigned_admin_user_id = $2, assigned_at = $3
      WHERE id = $1 AND assigned_admin_user_id IS NULL
      RETURNING *
      `,
      [conversationId, adminUserId, claimedAt]
    );
    return r.rows[0] || null;
  },

  async assign({ conversationId, adminUserId, assignedAt = new Date() }) {
    const r = await query(
      `
      UPDATE conversations
      SET assigned_admin_user_id = $2, assigned_at = $3
      WHERE id = $1
      RETURNING *
      `,
      [conversationId, adminUserId, assignedAt]
    );
    return r.rows[0] || null;
  },

  async release({ conversationId, adminUserId = null }) {
    if (adminUserId) {
      const r = await query(
        `
        UPDATE conversations
        SET assigned_admin_user_id = NULL, assigned_at = NULL
        WHERE id = $1 AND assigned_admin_user_id = $2
        RETURNING *
        `,
        [conversationId, adminUserId]
      );
      return r.rows[0] || null;
    }

    const r = await query(
      `
      UPDATE conversations
      SET assigned_admin_user_id = NULL, assigned_at = NULL
      WHERE id = $1
      RETURNING *
      `,
      [conversationId]
    );
    return r.rows[0] || null;
  },

  async close({ conversationId, closedAt = new Date() }) {
    const r = await query(
      `
      UPDATE conversations
      SET status = 'closed'
      WHERE id = $1 AND status <> 'closed'
      RETURNING *
      `,
      [conversationId]
    );
    return r.rows[0] || null;
  },
};

module.exports = { conversationsStore };
