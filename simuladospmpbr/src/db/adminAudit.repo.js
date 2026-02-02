import { getPool } from './pool.js';

let cachedHasTable = null;
let cachedAtMs = 0;

async function hasAdminAuditTable() {
  const now = Date.now();
  if (cachedHasTable != null && (now - cachedAtMs) < 60_000) return cachedHasTable;

  const pool = getPool();
  const { rows } = await pool.query(
    `select to_regclass('public.admin_audit_log') is not null as ok`
  );

  cachedHasTable = !!rows?.[0]?.ok;
  cachedAtMs = now;
  return cachedHasTable;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

export async function recordAdminAudit({ actor = null, ip = null, action, target = null, payload = null }) {
  try {
    const ok = await hasAdminAuditTable();
    if (!ok) return { ok: false, skipped: true, reason: 'ADMIN_AUDIT_TABLE_MISSING' };

    const pool = getPool();
    await pool.query(
      `insert into admin_audit_log (actor, ip, action, target, payload)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        actor ? String(actor) : null,
        ip ? String(ip) : null,
        String(action),
        target ? String(target) : null,
        safeJsonStringify(payload)
      ]
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
