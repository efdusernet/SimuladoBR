function safeDateMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Enforce premium expiration on a User row.
 *
 * Rule:
 * - If PremiumExpiresAt <= now (timestamp-level, includes minutes/seconds)
 *   then mark user as non-premium: BloqueioAtivado=true and PremiumExpiredAt=now.
 *
 * This is idempotent: if user is already BloqueioAtivado=true, it does nothing.
 */
async function enforcePremiumExpiry(user, { now = new Date() } = {}) {
  if (!user) return null;

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return user;

  const expiresMs = safeDateMs(user.PremiumExpiresAt);
  if (!expiresMs) return user; // null/invalid => treat as no expiry (lifetime)

  if (expiresMs > nowMs) return user; // still active

  // Already blocked => nothing to do
  if (user.BloqueioAtivado === true) return user;

  const patch = {
    BloqueioAtivado: true,
    PremiumExpiredAt: nowDate,
    DataAlteracao: nowDate,
  };

  try {
    await user.update(patch);
  } catch (_) {
    // best-effort; don't break auth flows
  }

  return user;
}

module.exports = {
  enforcePremiumExpiry,
};
