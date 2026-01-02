const { query } = require('../db/pool');

const messagesStore = {
  async insert({ id, conversationId, createdAt, role, text, senderName = null }) {
    await query(
      'INSERT INTO messages (id, conversation_id, created_at, role, text, sender_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, conversationId, createdAt, role, text, senderName]
    );
  },

  async listByConversationId(conversationId) {
    const r = await query(
      'SELECT id, conversation_id, role, text, created_at, sender_name FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    return r.rows;
  },
};

module.exports = { messagesStore };
