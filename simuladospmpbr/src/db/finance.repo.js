import { getPool } from './pool.js';

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeEmailLike(value) {
  const s = (value ?? '').toString().trim().toLowerCase();
  return s ? s : null;
}

function normalizeDateOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function buildDateRangeFilter({ fieldName, from, to }, params) {
  const clauses = [];
  if (from) {
    params.push(from.toISOString());
    clauses.push(`${fieldName} >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    clauses.push(`${fieldName} <= $${params.length}`);
  }
  return clauses;
}

export async function listOrders({
  from,
  to,
  dateField = 'created_at',
  status = null,
  planId = null,
  email = null,
  q = null,
  page = 1,
  pageSize = 25,
  sort = 'created_at',
  sortDir = 'desc'
}) {
  const pool = getPool();

  const safeDateField = dateField === 'paid_at' ? 'o.paid_at' : 'o.created_at';

  const safeSortMap = {
    created_at: 'o.created_at',
    paid_at: 'o.paid_at',
    amount_cents: 'o.amount_cents',
    status: 'o.status',
    plan: 'o.plan_id',
    email: 'b.email'
  };
  const sortExpr = safeSortMap[sort] ?? 'o.created_at';
  const dir = String(sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const p = clampInt(page, { min: 1, max: 10_000, fallback: 1 });
  const ps = clampInt(pageSize, { min: 1, max: 200, fallback: 25 });
  const offset = (p - 1) * ps;

  const params = [];
  const where = [];

  const fromDt = normalizeDateOrNull(from);
  const toDt = normalizeDateOrNull(to);
  where.push(...buildDateRangeFilter({ fieldName: safeDateField, from: fromDt, to: toDt }, params));

  if (status) {
    params.push(String(status));
    where.push(`o.status = $${params.length}::order_status`);
  }

  if (planId) {
    params.push(String(planId));
    where.push(`o.plan_id = $${params.length}`);
  }

  const emailLike = normalizeEmailLike(email);
  if (emailLike) {
    params.push(`%${emailLike}%`);
    where.push(`lower(b.email) like $${params.length}`);
  }

  const qRaw = (q ?? '').toString().trim();
  if (qRaw) {
    params.push(`%${qRaw}%`);
    const idx = params.length;
    where.push(`(cast(o.id as text) ilike $${idx} or coalesce(o.payment_reference,'') ilike $${idx})`);
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';

  const { rows: countRows } = await pool.query(
    `select count(*)::int as total
     from orders o
     join plans p on p.id = o.plan_id
     join buyers b on b.id = o.buyer_id
     ${whereSql}`,
    params
  );

  params.push(ps);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `select o.id, o.status, o.payment_method, o.amount_cents, o.currency,
            o.created_at, o.paid_at, o.due_date, o.expires_at,
            o.payment_provider, o.payment_reference, o.payment_object_type, o.payment_url,
            o.payment_metadata,
            p.id as plan_id, p.name as plan_name,
            b.email as buyer_email, b.first_name as buyer_first_name, b.last_name as buyer_last_name
     from orders o
     join plans p on p.id = o.plan_id
     join buyers b on b.id = o.buyer_id
     ${whereSql}
     order by ${sortExpr} ${dir} nulls last
     limit $${limitIdx} offset $${offsetIdx}`,
    params
  );

  return {
    page: p,
    pageSize: ps,
    total: countRows[0]?.total ?? 0,
    rows
  };
}

export async function getOrderDetail(orderId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select o.id, o.status, o.payment_method, o.amount_cents, o.currency,
            o.created_at, o.updated_at, o.paid_at, o.due_date, o.expires_at,
            o.payment_provider, o.payment_reference, o.payment_object_type, o.payment_url,
            o.payment_metadata,
            p.id as plan_id, p.name as plan_name, p.description as plan_description,
            b.id as buyer_id, b.email as buyer_email, b.first_name as buyer_first_name, b.last_name as buyer_last_name, b.cpf_cnpj as buyer_cpf_cnpj,
            e.id as entitlement_id, e.status as entitlement_status, e.starts_at as entitlement_starts_at, e.ends_at as entitlement_ends_at
     from orders o
     join plans p on p.id = o.plan_id
     join buyers b on b.id = o.buyer_id
     left join entitlements e on e.order_id = o.id
     where o.id = $1`,
    [String(orderId)]
  );
  return rows[0] ?? null;
}

export async function listRefundAndChargebackEvents({ from, to, email = null, page = 1, pageSize = 25 }) {
  const pool = getPool();

  const p = clampInt(page, { min: 1, max: 10_000, fallback: 1 });
  const ps = clampInt(pageSize, { min: 1, max: 200, fallback: 25 });
  const offset = (p - 1) * ps;

  const params = [];
  const where = [];

  const fromDt = normalizeDateOrNull(from);
  const toDt = normalizeDateOrNull(to);
  // Use updated_at as the closest we have to "event time" in MVP.
  where.push(...buildDateRangeFilter({ fieldName: 'o.updated_at', from: fromDt, to: toDt }, params));

  const emailLike = normalizeEmailLike(email);
  if (emailLike) {
    params.push(`%${emailLike}%`);
    where.push(`lower(b.email) like $${params.length}`);
  }

  // Refunds and chargebacks are represented as status transitions with last event in payment_metadata.
  where.push(`o.status in ('refunded','canceled')`);
  where.push(`(o.payment_metadata->>'asaasEvent') in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK')`);

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';

  const { rows: countRows } = await pool.query(
    `select count(*)::int as total
     from orders o
     join buyers b on b.id = o.buyer_id
     ${whereSql}`,
    params
  );

  params.push(ps);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `select o.id as order_id,
            o.status as order_status,
            o.amount_cents,
            o.currency,
            o.updated_at as event_at,
            o.payment_reference,
            (o.payment_metadata->>'asaasEvent') as asaas_event,
            (o.payment_metadata->>'asaasPaymentId') as asaas_payment_id,
            (o.payment_metadata->>'asaasPaymentStatus') as asaas_payment_status,
            p.id as plan_id,
            p.name as plan_name,
            b.email as buyer_email
     from orders o
     join plans p on p.id = o.plan_id
     join buyers b on b.id = o.buyer_id
     ${whereSql}
     order by o.updated_at desc
     limit $${limitIdx} offset $${offsetIdx}`,
    params
  );

  return {
    page: p,
    pageSize: ps,
    total: countRows[0]?.total ?? 0,
    rows
  };
}

export async function listExpirations({ bucket, now = null, page = 1, pageSize = 50 }) {
  const pool = getPool();

  const p = clampInt(page, { min: 1, max: 10_000, fallback: 1 });
  const ps = clampInt(pageSize, { min: 1, max: 200, fallback: 50 });
  const offset = (p - 1) * ps;

  const nowDt = now ? normalizeDateOrNull(now) : new Date();

  const params = [nowDt.toISOString()];
  const where = [];

  // We focus on expiring access windows; lifetime plans (ends_at is null) do not show here.
  where.push('e.ends_at is not null');

  if (bucket === 'expired') {
    where.push('(e.status <> \'active\' or e.ends_at <= $1::timestamptz)');
  } else {
    where.push('e.status = \'active\'');
    if (bucket === 'd1') {
      where.push('e.ends_at > $1::timestamptz and e.ends_at <= ($1::timestamptz + interval \'1 day\')');
    } else if (bucket === 'd7') {
      where.push('e.ends_at > $1::timestamptz and e.ends_at <= ($1::timestamptz + interval \'7 days\')');
    } else {
      // Default: d30
      where.push('e.ends_at > $1::timestamptz and e.ends_at <= ($1::timestamptz + interval \'30 days\')');
    }
  }

  const whereSql = `where ${where.join(' and ')}`;

  const { rows: countRows } = await pool.query(
    `select count(*)::int as total
     from entitlements e
     join buyers b on b.id = e.buyer_id
     join plans p on p.id = e.plan_id
     ${whereSql}`,
    params
  );

  params.push(ps);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `select e.id as entitlement_id, e.status as entitlement_status, e.starts_at, e.ends_at,
            p.id as plan_id, p.name as plan_name,
            b.email as buyer_email, b.first_name as buyer_first_name, b.last_name as buyer_last_name,
            e.order_id
     from entitlements e
     join buyers b on b.id = e.buyer_id
     join plans p on p.id = e.plan_id
     ${whereSql}
     order by e.ends_at asc
     limit $${limitIdx} offset $${offsetIdx}`,
    params
  );

  return {
    page: p,
    pageSize: ps,
    total: countRows[0]?.total ?? 0,
    rows
  };
}

export async function getFinanceKpis({ from, to }) {
  const pool = getPool();

  const fromDt = normalizeDateOrNull(from);
  const toDt = normalizeDateOrNull(to);

  // For KPI time window, use created_at for funnel and paid_at for revenue.
  const createdParams = [];
  const createdClauses = buildDateRangeFilter({ fieldName: 'o.created_at', from: fromDt, to: toDt }, createdParams);
  const createdWhereSql = createdClauses.length ? `where ${createdClauses.join(' and ')}` : '';

  const paidParams = [];
  const paidClauses = buildDateRangeFilter({ fieldName: 'o.paid_at', from: fromDt, to: toDt }, paidParams);
  const paidWhereSql = paidClauses.length ? `where ${paidClauses.join(' and ')}` : '';

  const { rows: createdRows } = await pool.query(
    `select
       count(*)::int as created_count,
       count(*) filter (where o.status = 'paid')::int as paid_count_by_created,
       count(*) filter (where o.status = 'pending_payment')::int as pending_count,
       count(*) filter (where o.status = 'expired')::int as overdue_count,
       count(*) filter (where o.status = 'canceled')::int as canceled_count,
       count(*) filter (where o.status = 'refunded')::int as refunded_count,
       count(*) filter (where o.status in ('refunded','canceled') and (o.payment_metadata->>'asaasEvent') = 'PAYMENT_REFUNDED')::int as refund_events_count,
       count(*) filter (where o.status in ('refunded','canceled') and (o.payment_metadata->>'asaasEvent') = 'PAYMENT_CHARGEBACK')::int as chargeback_events_count,
       coalesce(sum(o.amount_cents) filter (where o.status in ('refunded','canceled') and (o.payment_metadata->>'asaasEvent') in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK')), 0)::bigint as refund_chargeback_cents,
       coalesce(sum(o.amount_cents) filter (where o.status in ('pending_payment','expired')), 0)::bigint as delinquency_cents
     from orders o
     ${createdWhereSql}`,
    createdParams
  );

  const { rows: paidRows } = await pool.query(
    `select
       coalesce(sum(o.amount_cents) filter (where o.status = 'paid'), 0)::bigint as revenue_cents
     from orders o
     ${paidWhereSql}`,
    paidParams
  );

  const created = createdRows[0] ?? {};
  const paid = paidRows[0] ?? {};

  const createdCount = Number(created.created_count ?? 0);
  const paidCountByCreated = Number(created.paid_count_by_created ?? 0);

  const conversion = createdCount > 0 ? paidCountByCreated / createdCount : 0;

  // Churn (MVP): entitlements that ended in [from,to] and did NOT renew within 7 days.
  // We use ends_at as the expiry moment; a renewal is another entitlement for the same email
  // created within 7 days after the expiry and still active.
  const churnParams = [];
  const churnClauses = buildDateRangeFilter({ fieldName: 'e.ends_at', from: fromDt, to: toDt }, churnParams);
  const churnWhereSql = churnClauses.length ? `and ${churnClauses.join(' and ')}` : '';

  const { rows: churnRows } = await pool.query(
    `with expired as (
       select e.id, e.buyer_id, e.ends_at
       from entitlements e
       where e.ends_at is not null
         and e.ends_at <= now()
         ${churnWhereSql}
     ),
     expired_emails as (
       select b.email, ex.ends_at
       from expired ex
       join buyers b on b.id = ex.buyer_id
     ),
     renewed as (
       select distinct ee.email
       from expired_emails ee
       join buyers b on b.email = ee.email
       join entitlements e2 on e2.buyer_id = b.id
       where e2.status = 'active'
         and e2.created_at > ee.ends_at
         and e2.created_at <= (ee.ends_at + interval '7 days')
     ),
     churned as (
       select distinct ee.email
       from expired_emails ee
       where not exists (select 1 from renewed r where r.email = ee.email)
     )
     select
       (select count(*)::int from expired_emails) as expired_entitlements_count,
       (select count(*)::int from churned) as churned_emails_count`,
    churnParams
  );

  const churn = churnRows[0] ?? {};
  const expiredEntitlementsCount = Number(churn.expired_entitlements_count ?? 0);
  const churnedEmailsCount = Number(churn.churned_emails_count ?? 0);
  const churnRate = expiredEntitlementsCount > 0 ? churnedEmailsCount / expiredEntitlementsCount : 0;

  return {
    createdCount,
    paidCountByCreated,
    pendingCount: Number(created.pending_count ?? 0),
    overdueCount: Number(created.overdue_count ?? 0),
    canceledCount: Number(created.canceled_count ?? 0),
    refundedCount: Number(created.refunded_count ?? 0),
    refundEventsCount: Number(created.refund_events_count ?? 0),
    chargebackEventsCount: Number(created.chargeback_events_count ?? 0),
    refundChargebackCents: Number(created.refund_chargeback_cents ?? 0),
    delinquencyCents: Number(created.delinquency_cents ?? 0),
    revenueCents: Number(paid.revenue_cents ?? 0),
    conversion,
    churnedEmailsCount,
    expiredEntitlementsCount,
    churnRate
  };
}
