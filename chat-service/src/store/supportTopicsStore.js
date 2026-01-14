const { query } = require('../db/pool');

function normalizeTitle(raw) {
  const t = String(raw || '').trim();
  return t;
}

function normalizeMessageText(raw, fallbackTitle) {
  const t = String(raw || '').trim();
  return t || String(fallbackTitle || '').trim();
}

function normalizeAutoReplyText(raw) {
  const t = String(raw || '').trim();
  return t || null;
}

const supportTopicsStore = {
  async listPublic() {
    const r = await query(
      `
      SELECT id, title, message_text, auto_reply_text, sort_order
      FROM support_topics
      WHERE active = true
      ORDER BY sort_order ASC, created_at ASC
      `
    );
    return r.rows;
  },

  async listAdmin({ limit = 500 } = {}) {
    const finalLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
    const r = await query(
      `
      SELECT id, title, message_text, auto_reply_text, active, sort_order, created_at, updated_at
      FROM support_topics
      ORDER BY sort_order ASC, created_at ASC
      LIMIT $1
      `,
      [finalLimit]
    );
    return r.rows;
  },

  async getById(id) {
    const r = await query(
      'SELECT id, title, message_text, auto_reply_text, active, sort_order, created_at, updated_at FROM support_topics WHERE id = $1',
      [String(id)]
    );
    return r.rows[0] || null;
  },

  async create({ title, messageText, autoReplyText = null, active = true, sortOrder = 0 }) {
    const finalTitle = normalizeTitle(title);
    const finalMessage = normalizeMessageText(messageText, finalTitle);
    const finalAutoReply = autoReplyText == null ? null : normalizeAutoReplyText(autoReplyText);
    const finalSort = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0;

    const r = await query(
      `
      INSERT INTO support_topics (title, message_text, auto_reply_text, active, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, message_text, auto_reply_text, active, sort_order, created_at, updated_at
      `,
      [finalTitle, finalMessage, finalAutoReply, Boolean(active), finalSort]
    );
    return r.rows[0] || null;
  },

  async update(id, { title, messageText, autoReplyText, active, sortOrder } = {}) {
    const existing = await query(
      'SELECT id, title, message_text, auto_reply_text, active, sort_order FROM support_topics WHERE id = $1',
      [String(id)]
    );
    const cur = existing.rows[0] || null;
    if (!cur) return null;

    const finalTitle = title == null ? String(cur.title) : normalizeTitle(title);
    const finalMessage = messageText == null ? String(cur.message_text) : normalizeMessageText(messageText, finalTitle);
    const finalAutoReply = autoReplyText == null ? (cur.auto_reply_text == null ? null : String(cur.auto_reply_text)) : normalizeAutoReplyText(autoReplyText);
    const finalActive = active == null ? Boolean(cur.active) : Boolean(active);
    const finalSort = sortOrder == null ? Number(cur.sort_order) : (Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0);

    const r = await query(
      `
      UPDATE support_topics
      SET title = $2, message_text = $3, auto_reply_text = $4, active = $5, sort_order = $6, updated_at = now()
      WHERE id = $1
      RETURNING id, title, message_text, auto_reply_text, active, sort_order, created_at, updated_at
      `,
      [String(id), finalTitle, finalMessage, finalAutoReply, finalActive, finalSort]
    );
    return r.rows[0] || null;
  },

  async remove(id) {
    await query('DELETE FROM support_topics WHERE id = $1', [String(id)]);
  },
};

module.exports = { supportTopicsStore };
