import { getPool } from './pool.js';
import { grantEntitlementForOrder, getActiveEntitlementByEmail, getOrderById, setEntitlementStatusByOrderId } from './commerce.repo.js';
import { syncPremiumOnSimuladosBr } from '../integrations/simuladosbr/simuladosbr.client.js';
import { getPayment } from '../integrations/asaas/asaas.client.js';

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

function mapOrderStatusToEntitlementStatus(orderStatus) {
  switch (orderStatus) {
    case 'refunded':
      return 'refunded';
    case 'canceled':
      return 'revoked';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

function mapAsaasPaymentStatusToOrderStatus(paymentStatus) {
  const s = String(paymentStatus || '').toUpperCase();
  switch (s) {
    case 'RECEIVED':
    case 'CONFIRMED':
      return 'paid';
    case 'REFUNDED':
      return 'refunded';
    case 'OVERDUE':
      return 'expired';
    case 'CANCELED':
    case 'DELETED':
      return 'canceled';
    default:
      return 'pending_payment';
  }
}

export async function refreshOrderFromAsaas({ orderId }) {
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  const paymentId = order?.payment_metadata?.asaasPaymentId
    ?? (order.payment_object_type === 'payment' ? order.payment_reference : null);

  if (!paymentId) return { ok: false, reason: 'NO_PAYMENT_ID' };

  const payment = await getPayment(paymentId);
  const status = mapAsaasPaymentStatusToOrderStatus(payment?.status);

  const paidAt = status === 'paid' ? new Date().toISOString() : null;

  const updated = await setOrderStatusByPaymentReference({
    reference: order.payment_reference,
    status,
    paidAt,
    metadata: {
      asaasPaymentId: payment?.id ?? paymentId,
      asaasPaymentStatus: payment?.status ?? null,
      asaasInvoiceUrl: payment?.invoiceUrl ?? order?.payment_metadata?.asaasInvoiceUrl ?? null,
      asaasRefreshedAt: new Date().toISOString()
    }
  });

  if (!updated?.id) return { ok: false, reason: 'ORDER_NOT_UPDATED' };

  // Apply entitlement + premium sync rules similar to webhook processing.
  if (updated?.status === 'paid') {
    await grantEntitlementForOrder({ orderId: updated.id });
  } else if (updated.status === 'refunded' || updated.status === 'canceled' || updated.status === 'expired') {
    const entStatus = mapOrderStatusToEntitlementStatus(updated.status);
    if (entStatus) {
      await setEntitlementStatusByOrderId({ orderId: updated.id, status: entStatus });
    }
  }

  // Premium sync is best-effort.
  try {
    const buyerEmail = order?.buyer_email;
    if (buyerEmail) {
      const entitlement = await getActiveEntitlementByEmail(String(buyerEmail).trim().toLowerCase());
      await syncPremiumOnSimuladosBr({ email: String(buyerEmail).trim().toLowerCase(), entitlement });
    }
  } catch (_) {
    // ignore
  }

  return { ok: true, status: updated.status, paymentStatus: payment?.status ?? null };
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

    // Bridge (idempotent): sync Premium in SimuladosBR based on the currently active entitlement.
    try {
      const order = await getOrderById(updated.id);
      const buyerEmail = order?.buyer_email;
      if (buyerEmail) {
        const entitlement = await getActiveEntitlementByEmail(String(buyerEmail).trim().toLowerCase());
        await syncPremiumOnSimuladosBr({ email: String(buyerEmail).trim().toLowerCase(), entitlement });
      }
    } catch (e) {
      // Best-effort: do not fail webhook processing if cross-service sync fails.
      // eslint-disable-next-line no-console
      console.error('[asaas-webhook] premium sync to SimuladosBR failed:', e && e.message ? e.message : e);
    }
  } else if (updated?.id && (updated.status === 'refunded' || updated.status === 'canceled' || updated.status === 'expired')) {
    // If payment got revoked/refunded/expired, revoke the entitlement for this specific order.
    try {
      const entStatus = mapOrderStatusToEntitlementStatus(updated.status);
      if (entStatus) {
        await setEntitlementStatusByOrderId({ orderId: updated.id, status: entStatus });
      }

      const order = await getOrderById(updated.id);
      const buyerEmail = order?.buyer_email;
      if (buyerEmail) {
        const entitlement = await getActiveEntitlementByEmail(String(buyerEmail).trim().toLowerCase());
        await syncPremiumOnSimuladosBr({ email: String(buyerEmail).trim().toLowerCase(), entitlement });
      }
    } catch (e) {
      // Best-effort
      // eslint-disable-next-line no-console
      console.error('[asaas-webhook] revoke/sync failed:', e && e.message ? e.message : e);
    }
  }
}
