const { importSPKI, jwtVerify } = require('jose');
const { env } = require('../config/env');

let cachedKeyPromise = null;

async function getPublicKey() {
  const pem = env.JWT_PUBLIC_KEY_PEM;
  if (!pem) {
    const e = new Error('JWT_PUBLIC_KEY_PEM não configurada');
    e.code = 'JWT_NOT_CONFIGURED';
    throw e;
  }

  if (!cachedKeyPromise) {
    cachedKeyPromise = importSPKI(pem, env.JWT_ALGORITHMS[0] || 'RS256');
  }
  return cachedKeyPromise;
}

async function verifyJwt(token) {
  const key = await getPublicKey();

  const options = {
    algorithms: env.JWT_ALGORITHMS && env.JWT_ALGORITHMS.length ? env.JWT_ALGORITHMS : undefined,
  };
  if (env.JWT_ISSUER) options.issuer = env.JWT_ISSUER;
  if (env.JWT_AUDIENCE) options.audience = env.JWT_AUDIENCE;

  const { payload } = await jwtVerify(token, key, options);
  const userId = payload && payload.sub ? String(payload.sub) : null;

  return {
    userId,
    claims: payload || {},
  };
}

module.exports = { verifyJwt };
