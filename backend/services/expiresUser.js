const db = require('../models');

/**
 * Mark a user as having an expired password.
 *
 * Business rule: sets pwdExpired=true and pwdExpiredDate=NOW.
 *
 * @param {number} userId
 * @param {Date|string|number|null} date Optional date. If omitted/null, uses DB NOW().
 * @param {object} [options]
 * @param {object} [options.transaction] Sequelize transaction.
 */
async function expiresUser(userId, date = null, options = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid userId');

  const values = { PwdExpired: true };
  if (date) {
    values.PwdExpiredDate = new Date(date);
  } else {
    values.PwdExpiredDate = db.sequelize.fn('NOW');
  }

  const [affectedCount] = await db.User.update(values, {
    where: { Id: id },
    transaction: options.transaction
  });

  return { affectedCount };
}

module.exports = { expiresUser };
