import { getPool } from './pool.js';

export async function listActivePlans() {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, name, description, price_cents, currency, access_duration_days, is_free
     from plans
     where is_active = true
     order by
       case
         when is_free then 0
         else 1
       end,
       price_cents asc`
  );
  return rows;
}

export async function upsertBuyer({ firstName, lastName, email, cpfCnpj = null }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `insert into buyers (first_name, last_name, email, cpf_cnpj)
     values ($1, $2, $3, $4)
     on conflict (email) do update set
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       cpf_cnpj = coalesce(excluded.cpf_cnpj, buyers.cpf_cnpj)
     returning id, first_name, last_name, email, cpf_cnpj, created_at`,
    [firstName, lastName, email, cpfCnpj]
  );
  return rows[0];
}

export async function getPlanById(planId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, name, description, price_cents, currency, access_duration_days, is_free, is_active
     from plans
     where id = $1`,
    [planId]
  );
  return rows[0] ?? null;
}

export async function createOrder({ buyerId, planId, paymentMethod }) {
  const pool = getPool();

  const plan = await getPlanById(planId);
  if (!plan || !plan.is_active) {
    const err = new Error('Plano inválido');
    err.status = 400;
    throw err;
  }

  if (plan.is_free) {
    const err = new Error('Plano gratuito não gera pedido de pagamento');
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(plan.price_cents) || plan.price_cents <= 0) {
    const err = new Error('Plano sem preço configurado');
    err.status = 400;
    throw err;
  }

  const method = paymentMethod;

  const now = new Date();
  const dueDate = new Date(now);
  if (method === 'boleto') {
    dueDate.setDate(dueDate.getDate() + 7);
  } else {
    // Keep a short window for PIX/card (still payable after, but used for our UX)
    dueDate.setDate(dueDate.getDate() + 3);
  }

  const expiresAt = new Date(dueDate);
  expiresAt.setHours(23, 59, 59, 999);

  const { rows } = await pool.query(
    `insert into orders (buyer_id, plan_id, payment_method, status, amount_cents, currency, due_date, expires_at)
     values ($1, $2, $3::payment_method, 'created', $4, $5, $6::date, $7)
     returning id, buyer_id, plan_id, payment_method, status, amount_cents, currency, due_date, expires_at, created_at`,
    [buyerId, plan.id, method, plan.price_cents, plan.currency, dueDate.toISOString().slice(0, 10), expiresAt.toISOString()]
  );

  return rows[0];
}

export async function getOrderById(orderId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select o.id, o.status, o.payment_method, o.amount_cents, o.currency, o.created_at, o.paid_at,
            o.payment_provider, o.payment_reference, o.payment_object_type, o.payment_url,
            o.due_date, o.expires_at,
            p.id as plan_id, p.name as plan_name, p.description as plan_description,
            b.first_name as buyer_first_name, b.last_name as buyer_last_name, b.email as buyer_email
     from orders o
     join plans p on p.id = o.plan_id
     join buyers b on b.id = o.buyer_id
     where o.id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

export async function grantEntitlementForOrder({ orderId }) {
  const pool = getPool();

  const { rows: orderRows } = await pool.query(
    `select o.id, o.buyer_id, o.plan_id, o.status, p.access_duration_days
     from orders o
     join plans p on p.id = o.plan_id
     where o.id = $1`,
    [orderId]
  );

  const order = orderRows[0];
  if (!order) return null;
  if (order.status !== 'paid') return null;

  const endsAt = order.access_duration_days
    ? new Date(Date.now() + Number(order.access_duration_days) * 24 * 60 * 60 * 1000)
    : null;

  const { rows } = await pool.query(
    `insert into entitlements (buyer_id, plan_id, order_id, status, starts_at, ends_at)
     values ($1, $2, $3, 'active', now(), $4)
     on conflict (order_id) do nothing
     returning id, buyer_id, plan_id, status, starts_at, ends_at`,
    [order.buyer_id, order.plan_id, order.id, endsAt ? endsAt.toISOString() : null]
  );

  return rows[0] ?? null;
}

export async function grantFreeEntitlement({ buyerId, planId }) {
  const pool = getPool();
  const plan = await getPlanById(planId);
  if (!plan || !plan.is_active || !plan.is_free) {
    const err = new Error('Plano gratuito inválido');
    err.status = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `insert into entitlements (buyer_id, plan_id, order_id, status, starts_at, ends_at)
     values ($1, $2, null, 'active', now(), null)
     returning id, buyer_id, plan_id, status, starts_at, ends_at`,
    [buyerId, planId]
  );

  return rows[0];
}

export async function getActiveEntitlementByEmail(email) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select e.id, e.plan_id, e.status, e.starts_at, e.ends_at,
            p.name as plan_name
     from entitlements e
     join buyers b on b.id = e.buyer_id
     join plans p on p.id = e.plan_id
     where b.email = $1
       and e.status = 'active'
       and (e.ends_at is null or e.ends_at > now())
     order by e.created_at desc
     limit 1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function setEntitlementStatusByOrderId({ orderId, status }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `update entitlements
     set status = $2::entitlement_status,
         ends_at = case
           when ends_at is null then now()
           when ends_at > now() then now()
           else ends_at
         end
     where order_id = $1
       and status = 'active'
     returning id, order_id, status, ends_at`,
    [orderId, status]
  );
  return rows[0] ?? null;
}
