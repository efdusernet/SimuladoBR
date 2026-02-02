import crypto from 'crypto';
import { getPool } from './pool.js';

let cachedHasTable = null;
let cachedAtMs = 0;

async function hasPaymentEventsTable() {
  const now = Date.now();
  if (cachedHasTable != null && (now - cachedAtMs) < 60_000) return cachedHasTable;

  const pool = getPool();
  const { rows } = await pool.query(
    `select to_regclass('public.payment_events') is not null as ok`
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

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function pickSafeHeaders(headers) {
  const h = headers || {};
  const pick = (k) => {
    const v = h[k];
    if (v == null) return null;
    if (Array.isArray(v)) return v.join(',');
    return String(v);
  };

  return {
    'content-type': pick('content-type'),
    'user-agent': pick('user-agent'),
    'x-forwarded-for': pick('x-forwarded-for'),
    'x-real-ip': pick('x-real-ip'),
    'x-request-id': pick('x-request-id')
  };
}

async function resolveOrderIdByPaymentReference(paymentReference) {
  if (!paymentReference) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    `select id from orders where payment_reference = $1 limit 1`,
    [String(paymentReference)]
  );
  return rows?.[0]?.id ?? null;
}

export async function recordAsaasWebhookEvent({ headers, payload }) {
  try {
    const ok = await hasPaymentEventsTable();
    if (!ok) return { ok: false, skipped: true, reason: 'PAYMENT_EVENTS_TABLE_MISSING' };

    const eventType = payload?.event ? String(payload.event) : null;
    const payment = payload?.payment ?? null;
    const paymentId = payment?.id ? String(payment.id) : null;
    const paymentLinkId = payload?.paymentLink ? String(payload.paymentLink) : null;
    const paymentReference = paymentLinkId || paymentId || null;

    const externalReference = payment?.externalReference ? String(payment.externalReference) : null;

    let orderId = null;
    if (externalReference && isUuid(externalReference)) {
      orderId = externalReference;
    } else if (paymentReference) {
      orderId = await resolveOrderIdByPaymentReference(paymentReference);
    }

    const payloadText = safeJsonStringify(payload);
    const payloadHash = sha256Hex(payloadText);

    const pool = getPool();
    await pool.query(
      `insert into payment_events (
         provider, event_type,
         payment_reference, payment_id, payment_link_id, external_reference,
         order_id,
         payload, payload_hash,
         headers
       )
       values (
         $1, $2,
         $3, $4, $5, $6,
         $7,
         $8::jsonb, $9,
         $10::jsonb
       )
       on conflict (provider, payload_hash) do nothing`,
      [
        'asaas',
        eventType || 'UNKNOWN',
        paymentReference,
        paymentId,
        paymentLinkId,
        externalReference,
        orderId,
        payloadText,
        payloadHash,
        safeJsonStringify(pickSafeHeaders(headers))
      ]
    );

    return { ok: true };
  } catch (e) {
    // Best-effort: timeline recording must never break webhook processing.
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function listPaymentEventsForOrder({ orderId, paymentReference = null, limit = 50 }) {
  const ok = await hasPaymentEventsTable();
  if (!ok) return [];

  const pool = getPool();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));

  if (orderId) {
    const { rows } = await pool.query(
      `select id, created_at, provider, event_type, payment_reference, payment_id, payment_link_id, external_reference, payload
       from payment_events
       where order_id = $1
       order by created_at desc
       limit $2`,
      [String(orderId), lim]
    );
    return rows;
  }

  if (paymentReference) {
    const { rows } = await pool.query(
      `select id, created_at, provider, event_type, payment_reference, payment_id, payment_link_id, external_reference, payload
       from payment_events
       where payment_reference = $1
       order by created_at desc
       limit $2`,
      [String(paymentReference), lim]
    );
    return rows;
  }

  return [];
}

export async function listRefundAndChargebackEventsV2({ from, to, email = null, page = 1, pageSize = 25 }) {
  const ok = await hasPaymentEventsTable();
  if (!ok) return null;

  const pool = getPool();
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  const ps = Math.max(1, Math.min(200, Math.trunc(Number(pageSize) || 25)));
  const offset = (p - 1) * ps;

  const params = [];
  const where = [`pe.provider = 'asaas'`, `pe.event_type in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK')`];

  if (from) {
    params.push(new Date(String(from)).toISOString());
    where.push(`pe.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(new Date(String(to)).toISOString());
    where.push(`pe.created_at <= $${params.length}::timestamptz`);
  }

  if (email) {
    params.push(`%${String(email).trim().toLowerCase()}%`);
    where.push(`lower(b.email) like $${params.length}`);
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';

  const { rows: countRows } = await pool.query(
    `select count(*)::int as total
     from payment_events pe
     left join orders o on o.id = pe.order_id
     left join buyers b on b.id = o.buyer_id
     ${whereSql}`,
    params
  );

  params.push(ps);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `select
        o.id as order_id,
        o.status as order_status,
        o.amount_cents,
        o.currency,
        pe.created_at as event_at,
        o.payment_reference,
        pe.event_type as asaas_event,
        (pe.payload->'payment'->>'id') as asaas_payment_id,
        (pe.payload->'payment'->>'status') as asaas_payment_status,
        p.id as plan_id,
        p.name as plan_name,
        b.email as buyer_email
     from payment_events pe
     left join orders o on o.id = pe.order_id
     left join plans p on p.id = o.plan_id
     left join buyers b on b.id = o.buyer_id
     ${whereSql}
     order by pe.created_at desc
     limit $${limitIdx} offset $${offsetIdx}`,
    params
  );

  return { page: p, pageSize: ps, total: countRows?.[0]?.total ?? 0, rows };
}
