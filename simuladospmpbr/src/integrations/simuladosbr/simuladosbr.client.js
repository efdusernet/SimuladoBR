import { config } from '../../shared/config.js';

function getBaseUrl() {
  const raw = config.simuladosBrBaseUrl;
  return raw ? String(raw).trim().replace(/\/$/, '') : null;
}

export async function grantPremiumOnSimuladosBr({ email, days }) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return { ok: false, skipped: true, reason: 'SIMULADOS_BR_BASE_URL_NOT_SET' };
  if (!config.accessApiKey) return { ok: false, skipped: true, reason: 'ACCESS_API_KEY_NOT_SET' };

  const res = await fetch(`${baseUrl}/internal/v1/premium/grant`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-access-api-key': config.accessApiKey,
    },
    body: JSON.stringify({ email, days }),
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const err = new Error(`SimuladosBR premium grant failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data ?? { ok: true };
}

export async function syncPremiumOnSimuladosBr({ email, entitlement }) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return { ok: false, skipped: true, reason: 'SIMULADOS_BR_BASE_URL_NOT_SET' };
  if (!config.accessApiKey) return { ok: false, skipped: true, reason: 'ACCESS_API_KEY_NOT_SET' };

  const active = !!entitlement;
  const expiresAt = active
    ? (entitlement.ends_at ? new Date(entitlement.ends_at).toISOString() : null)
    : null;

  const res = await fetch(`${baseUrl}/internal/v1/premium/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-access-api-key': config.accessApiKey,
    },
    body: JSON.stringify({ email, active, expiresAt }),
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const err = new Error(`SimuladosBR premium sync failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data ?? { ok: true };
}
