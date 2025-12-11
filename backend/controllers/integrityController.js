const { createRemoteJWKSet, jwtVerify } = require('jose');

const { logger } = require('../utils/logger');
// Minimal Play Integrity verification scaffold.
// Expect a signed JWS token in req.body.token.
// Uses JWKS URL from env INTEGRITY_JWKS_URL when provided.
// Validates packageName and basic timestamp skew if CLAIM checks are present.

const DEFAULT_ALLOWED_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function getEnv(name, def = undefined) {
  return process.env[name] || def;
}

exports.verify = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, error: 'token required' });
    }

    const expectedPkg = getEnv('ANDROID_PACKAGE_NAME');
    const jwksUrl = getEnv('INTEGRITY_JWKS_URL');

    let payload = null;
    let header = null;
    let verified = false;
    let warnings = [];

    if (jwksUrl) {
      try {
        const JWKS = createRemoteJWKSet(new URL(jwksUrl));
        const { payload: p, protectedHeader } = await jwtVerify(token, JWKS, {
          // Audience/issuer checks can be added here when you define them
        });
        payload = p; header = protectedHeader; verified = true;
      } catch (err) {
        warnings.push('Signature verification failed against provided JWKS.');
      }
    }

    if (!verified) {
      // Fallback: decode without verification
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const json = Buffer.from(parts[1], 'base64url').toString('utf8');
          payload = JSON.parse(json);
        }
        const hdr = Buffer.from(parts[0], 'base64url').toString('utf8');
        header = JSON.parse(hdr);
        warnings.push('Token decoded without signature verification (JWKS not configured).');
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'invalid JWS format' });
      }
    }

    // Optional semantic checks (adapt to your chosen attestation format)
    if (expectedPkg && payload && payload.apkPackageName && payload.apkPackageName !== expectedPkg) {
      return res.status(400).json({ ok: false, error: 'package mismatch' });
    }

    // Timestamp check if present (example claim names vary by API version)
    const now = Date.now();
    const ts = payload && (payload.timestampMs || payload.timestamp || payload.iat * 1000);
    if (ts && Math.abs(now - Number(ts)) > DEFAULT_ALLOWED_SKEW_MS) {
      warnings.push('Attestation timestamp outside allowed skew.');
    }

    return res.json({ ok: verified, header, payload, warnings });
  } catch (err) {
    logger.error('Integrity verify error:', err);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
};
