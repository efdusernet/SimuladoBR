const express = require('express');
const router = express.Router();
const db = require('../models');
const { badRequest, unauthorized, notFound, internalError } = require('../middleware/errors');

function getAccessApiKeyFromEnv() {
  return String(process.env.ACCESS_API_KEY || '').trim();
}

function requireAccessApiKey(req, next) {
  const apiKey = String(req.headers['x-access-api-key'] || '').trim();
  const expected = getAccessApiKeyFromEnv();
  if (!expected || apiKey !== expected) {
    return next(unauthorized('Invalid API key', 'INVALID_API_KEY'));
  }
  return null;
}

function parseIsoDateOrNull(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return undefined;
  return dt;
}

// POST /internal/v1/premium/sync
// Body: { email: string, active: boolean, expiresAt?: string|null }
// Auth: header x-access-api-key must match ACCESS_API_KEY
// Effect:
//   - active=true  => BloqueioAtivado=false; PremiumExpiresAt=expiresAt (or null for lifetime)
//   - active=false => BloqueioAtivado=true;  PremiumExpiresAt=null
router.post('/premium/sync', async (req, res, next) => {
  try {
    const authErr = requireAccessApiKey(req, next);
    if (authErr) return;

    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return next(badRequest('email_required', 'EMAIL_REQUIRED'));

    const active = body.active === true;
    const expiresAtParsed = active ? parseIsoDateOrNull(body.expiresAt ?? body.PremiumExpiresAt ?? body.premiumExpiresAt) : null;
    if (active && expiresAtParsed === undefined) {
      return next(badRequest('expiresAt_invalid', 'EXPIRES_AT_INVALID'));
    }

    const Op = db.Sequelize && db.Sequelize.Op;
    const where = Op ? { Email: { [Op.iLike]: email } } : { Email: email };
    const user = await db.User.findOne({ where });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    await user.update({
      PremiumExpiresAt: active ? (expiresAtParsed ?? null) : null,
      PremiumExpiredAt: active ? null : user.PremiumExpiredAt,
      BloqueioAtivado: active ? false : true,
      DataAlteracao: new Date(),
    });

    return res.json({
      ok: true,
      userId: user.Id,
      email: user.Email,
      active,
      PremiumExpiresAt: user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).toISOString() : null,
    });
  } catch (e) {
    return next(internalError('Internal error', 'INTERNAL_PREMIUM_SYNC_ERROR', { error: e && e.message }));
  }
});

// POST /internal/v1/premium/grant
// Body: { email: string, days: number }
// Auth: header x-access-api-key must match ACCESS_API_KEY
// Effect: extends Usuario.PremiumExpiresAt by <days> starting from max(now, current PremiumExpiresAt)
// and (for now) sets BloqueioAtivado=false (current premium gating).
router.post('/premium/grant', async (req, res, next) => {
  try {
    const authErr = requireAccessApiKey(req, next);
    if (authErr) return;

    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return next(badRequest('email_required', 'EMAIL_REQUIRED'));

    const daysRaw = body.days;
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) {
      return next(badRequest('days_invalid', 'DAYS_INVALID'));
    }
    if (days > 3650) {
      return next(badRequest('days_too_large', 'DAYS_TOO_LARGE'));
    }

    const Op = db.Sequelize && db.Sequelize.Op;
    const where = Op ? { Email: { [Op.iLike]: email } } : { Email: email };

    const user = await db.User.findOne({ where });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    const nowMs = Date.now();
    const currentMs = user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).getTime() : 0;
    const baseMs = currentMs && currentMs > nowMs ? currentMs : nowMs;
    const newExpiresAt = new Date(baseMs + (days * 24 * 60 * 60 * 1000));

    await user.update({
      PremiumExpiresAt: newExpiresAt,
      PremiumExpiredAt: null,
      BloqueioAtivado: false,
      DataAlteracao: new Date(),
    });

    return res.json({
      ok: true,
      userId: user.Id,
      email: user.Email,
      daysAdded: days,
      PremiumExpiresAt: user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).toISOString() : null,
    });
  } catch (e) {
    return next(internalError('Internal error', 'INTERNAL_PREMIUM_GRANT_ERROR', { error: e && e.message }));
  }
});

module.exports = router;
