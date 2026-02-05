function toIsoOrNull(dt) {
  try {
    if (!dt) return null;
    const d = dt instanceof Date ? dt : new Date(dt);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  } catch (_) {
    return null;
  }
}

function computePremiumRemainingFromUser(user, { nowMs = Date.now() } = {}) {
  const isPremium = Boolean(user) && user.BloqueioAtivado === false;

  const expiresAt = user && user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt) : null;
  const expiresAtMs = expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt.getTime() : null;

  const lifetime = isPremium && !expiresAtMs;

  const remainingDays = (() => {
    if (!isPremium) return 0;
    if (lifetime) return null;
    const dayMs = 24 * 60 * 60 * 1000;
    const ms = expiresAtMs != null ? (expiresAtMs - nowMs) : 0;
    return Math.max(0, Math.ceil(ms / dayMs));
  })();

  return {
    isPremium,
    lifetime,
    PremiumExpiresAt: expiresAtMs != null ? new Date(expiresAtMs).toISOString() : null,
    remainingDays,
    serverNow: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  computePremiumRemainingFromUser,
  toIsoOrNull,
};
