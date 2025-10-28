const crypto = require('crypto');

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateVerificationCode(length = 6) {
  // crypto.randomBytes and map bytes to alphanumeric chars
  const buf = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUM[buf[i] % ALPHANUM.length];
  }
  return out;
}

module.exports = { generateVerificationCode };
