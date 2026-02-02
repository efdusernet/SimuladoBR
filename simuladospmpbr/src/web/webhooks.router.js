import { Router } from 'express';
import { config } from '../shared/config.js';
import { updateOrderFromAsaasWebhook } from '../db/orders.repo.js';
import { recordAsaasWebhookEvent } from '../db/paymentEvents.repo.js';

export const webhooksRouter = Router();

webhooksRouter.post('/webhooks/asaas', async (req, res, next) => {
  try {
    if (config.asaasWebhookToken) {
      const token = req.headers['asaas-access-token'];
      if (token !== config.asaasWebhookToken) {
        return res.status(401).json({ ok: false });
      }
    }

    // Best-effort (V2): store webhook event for later auditing/reconciliation.
    try {
      await recordAsaasWebhookEvent({ headers: req.headers, payload: req.body });
    } catch (_) {
      // ignore
    }

    await updateOrderFromAsaasWebhook(req.body);
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
