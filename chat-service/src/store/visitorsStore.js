const { query } = require('../db/pool');

const visitorsStore = {
  async insert({ id, createdAt, userId }) {
    await query(
      'INSERT INTO visitors (id, created_at, user_id) VALUES ($1, $2, $3)',
      [id, createdAt, userId]
    );
  },

  async ensureExists({ id, createdAt, userId }) {
    await query(
      'INSERT INTO visitors (id, created_at, user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, createdAt, userId]
    );
  },
};

module.exports = { visitorsStore };
