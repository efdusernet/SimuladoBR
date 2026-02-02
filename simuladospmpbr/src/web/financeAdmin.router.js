import { Router } from 'express';

import { requireAdminBasicAuth } from './adminAuth.js';
import { getFinanceKpis, getOrderDetail, listExpirations, listOrders, listRefundAndChargebackEvents } from '../db/finance.repo.js';

export const financeAdminRouter = Router();

financeAdminRouter.use('/admin/finance', requireAdminBasicAuth);

function moneyBRL(cents) {
  const v = Number(cents ?? 0) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(value) {
  const v = Number(value ?? 0);
  return (v * 100).toFixed(1) + '%';
}

function toCsv(rows, headers) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[\n\r,\"]/g.test(s)) {
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  };

  const lines = [];
  lines.push(headers.map(h => escape(h.label)).join(','));
  for (const r of rows) {
    lines.push(headers.map(h => escape(typeof h.value === 'function' ? h.value(r) : r[h.value])).join(','));
  }
  return lines.join('\n');
}

financeAdminRouter.get('/admin/finance', async (req, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = req.query.to ?? now.toISOString();

    const kpis = await getFinanceKpis({ from, to });

    return res.render('pages/admin_finance_dashboard', {
      title: 'Financeiro — Dashboard',
      query: { from, to },
      kpis,
      fmt: { moneyBRL, pct }
    });
  } catch (err) {
    next(err);
  }
});

financeAdminRouter.get('/admin/finance/orders', async (req, res, next) => {
  try {
    const format = String(req.query.format ?? '').toLowerCase();

    const result = await listOrders({
      from: req.query.from ?? null,
      to: req.query.to ?? null,
      dateField: req.query.dateField === 'paid_at' ? 'paid_at' : 'created_at',
      status: typeof req.query.status === 'string' && req.query.status ? req.query.status : null,
      planId: typeof req.query.planId === 'string' && req.query.planId ? req.query.planId : null,
      email: typeof req.query.email === 'string' && req.query.email ? req.query.email : null,
      q: typeof req.query.q === 'string' && req.query.q ? req.query.q : null,
      page: req.query.page ?? 1,
      pageSize: req.query.pageSize ?? 25,
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'created_at',
      sortDir: typeof req.query.sortDir === 'string' ? req.query.sortDir : 'desc'
    });

    if (format === 'csv') {
      const csv = toCsv(result.rows, [
        { label: 'order_id', value: 'id' },
        { label: 'status', value: 'status' },
        { label: 'email', value: 'buyer_email' },
        { label: 'plan_id', value: 'plan_id' },
        { label: 'plan_name', value: 'plan_name' },
        { label: 'amount_cents', value: 'amount_cents' },
        { label: 'created_at', value: 'created_at' },
        { label: 'paid_at', value: 'paid_at' },
        { label: 'payment_reference', value: 'payment_reference' },
        { label: 'asaas_event', value: (r) => r?.payment_metadata?.asaasEvent ?? '' }
      ]);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="orders.csv"');
      return res.status(200).send(csv);
    }

    return res.render('pages/admin_finance_orders', {
      title: 'Financeiro — Pedidos/Pagamentos',
      query: req.query,
      result,
      fmt: { moneyBRL }
    });
  } catch (err) {
    next(err);
  }
});

financeAdminRouter.get('/admin/finance/refunds', async (req, res, next) => {
  try {
    const format = String(req.query.format ?? '').toLowerCase();

    const result = await listRefundAndChargebackEvents({
      from: req.query.from ?? null,
      to: req.query.to ?? null,
      email: typeof req.query.email === 'string' && req.query.email ? req.query.email : null,
      page: req.query.page ?? 1,
      pageSize: req.query.pageSize ?? 25
    });

    if (format === 'csv') {
      const csv = toCsv(result.rows, [
        { label: 'order_id', value: 'order_id' },
        { label: 'type', value: (r) => r.asaas_event === 'PAYMENT_CHARGEBACK' ? 'chargeback' : 'refund' },
        { label: 'order_status', value: 'order_status' },
        { label: 'event_at', value: 'event_at' },
        { label: 'email', value: 'buyer_email' },
        { label: 'plan_id', value: 'plan_id' },
        { label: 'amount_cents', value: 'amount_cents' },
        { label: 'asaas_event', value: 'asaas_event' },
        { label: 'asaas_payment_id', value: 'asaas_payment_id' },
        { label: 'payment_reference', value: 'payment_reference' }
      ]);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="refunds_chargebacks.csv"');
      return res.status(200).send(csv);
    }

    return res.render('pages/admin_finance_refunds', {
      title: 'Financeiro — Reembolsos/Chargebacks',
      query: req.query,
      result,
      fmt: { moneyBRL }
    });
  } catch (err) {
    next(err);
  }
});

financeAdminRouter.get('/admin/finance/expirations', async (req, res, next) => {
  try {
    const format = String(req.query.format ?? '').toLowerCase();
    const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : 'd30';

    const result = await listExpirations({
      bucket: ['d30', 'd7', 'd1', 'expired'].includes(bucket) ? bucket : 'd30',
      page: req.query.page ?? 1,
      pageSize: req.query.pageSize ?? 50
    });

    if (format === 'csv') {
      const csv = toCsv(result.rows, [
        { label: 'entitlement_id', value: 'entitlement_id' },
        { label: 'status', value: 'entitlement_status' },
        { label: 'email', value: 'buyer_email' },
        { label: 'plan_id', value: 'plan_id' },
        { label: 'plan_name', value: 'plan_name' },
        { label: 'starts_at', value: 'starts_at' },
        { label: 'ends_at', value: 'ends_at' },
        { label: 'order_id', value: 'order_id' }
      ]);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="expirations.csv"');
      return res.status(200).send(csv);
    }

    return res.render('pages/admin_finance_expirations', {
      title: 'Financeiro — Expirações',
      query: req.query,
      bucket,
      result
    });
  } catch (err) {
    next(err);
  }
});

financeAdminRouter.get('/admin/finance/orders/:id', async (req, res, next) => {
  try {
    const order = await getOrderDetail(req.params.id);
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Erro',
        status: 404,
        message: 'Pedido não encontrado.',
        requestId: null
      });
    }

    return res.render('pages/admin_finance_order_detail', {
      title: `Financeiro — Pedido ${order.id}`,
      order,
      fmt: { moneyBRL }
    });
  } catch (err) {
    next(err);
  }
});
