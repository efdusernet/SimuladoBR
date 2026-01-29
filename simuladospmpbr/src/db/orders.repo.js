import { getPool } from './pool.js';
import { grantEntitlementForOrder } from './commerce.repo.js';

export async function attachPaymentToOrder({ orderId, provider, reference, url, status, metadata }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `update orders
     set payment_provider = $2,
         payment_reference = $3,
         payment_object_type = $4,
         payment_url = $5,
         status = $6::order_status,
         payment_metadata = $7,
         updated_at = now()
     where id = $1
     returning id, status, payment_provider, payment_reference, payment_object_type, payment_url`,
    [orderId, provider, reference, metadata?.objectType ?? null, url, status, metadata ?? null]
  );

  return rows[0] ?? null;
}

export async function getOrderByPaymentReference(reference) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, status, payment_reference, payment_object_type
     from orders
     where payment_reference = $1`,
    [reference]
  );
  return rows[0] ?? null;
}

export async function setOrderStatusByPaymentReference({ reference, status, metadata, paidAt = null }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `update orders
     set status = $2::order_status,
         payment_metadata = coalesce(payment_metadata, '{}'::jsonb) || $3::jsonb,
         paid_at = coalesce(paid_at, $4),
         updated_at = now()
     where payment_reference = $1
     returning id, status`,
    [reference, status, JSON.stringify(metadata ?? {}), paidAt]
  );
  return rows[0] ?? null;
}

function mapAsaasEventToOrderStatus(event) {
  // Common events (per Asaas docs): PAYMENT_CREATED, PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED, PAYMENT_CHARGEBACK
  switch (event) {
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      return 'paid';
    case 'PAYMENT_REFUNDED':
      return 'refunded';
    case 'PAYMENT_DELETED':
    case 'PAYMENT_CHARGEBACK':
      return 'canceled';
    case 'PAYMENT_OVERDUE':
      return 'expired';
    case 'PAYMENT_CREATED':
    default:
      return 'pending_payment';
  }
}

export async function updateOrderFromAsaasWebhook(payload) {
  const event = payload?.event;
  const payment = payload?.payment;
  const paymentId = payment?.id;
  const paymentLinkId = payload?.paymentLink ?? null;

  if (!event) return;

  const reference = paymentLinkId || paymentId;
  if (!reference) return;

  const status = mapAsaasEventToOrderStatus(event);

  const paidAt = status === 'paid' ? new Date().toISOString() : null;

  const updated = await setOrderStatusByPaymentReference({
    reference,
    status,
    paidAt,
    metadata: {
      asaasEvent: event,
      asaasPaymentId: paymentId ?? null,
      asaasPaymentLinkId: paymentLinkId ?? null,
      asaasPaymentStatus: payment?.status ?? null,
      asaasInvoiceUrl: payment?.invoiceUrl ?? null,
      updatedAt: new Date().toISOString()
    }
  });

  if (updated?.status === 'paid') {
    // Grant access after confirmation (PIX/CC approval/BOLETO compensation)
    await grantEntitlementForOrder({ orderId: updated.id });
  }
}
