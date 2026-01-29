import { Router } from 'express';
import { config } from '../shared/config.js';
import { getMyAccount, listCustomers } from '../integrations/asaas/asaas.client.js';

export const debugRouter = Router();

debugRouter.get('/debug/asaas/ping', async (req, res, next) => {
  try {
    if (config.nodeEnv === 'production') {
      return res.status(404).json({ ok: false });
    }

    const startedAt = Date.now();

    const baseUrl = config.asaasBaseUrl ?? null;

    try {
      const account = await getMyAccount();
      return res.status(200).json({
        ok: true,
        provider: 'asaas',
        endpoint: 'myAccount',
        baseUrl,
        elapsedMs: Date.now() - startedAt,
        account: {
          id: account?.id ?? null,
          name: account?.name ?? null
        }
      });
    } catch (err1) {
      try {
        const customers = await listCustomers({ limit: 1, offset: 0 });
        return res.status(200).json({
          ok: true,
          provider: 'asaas',
          endpoint: 'customers',
          baseUrl,
          elapsedMs: Date.now() - startedAt,
          customersCount: customers?.totalCount ?? null
        });
      } catch (err2) {
        return res.status(200).json({
          ok: false,
          provider: 'asaas',
          baseUrl,
          elapsedMs: Date.now() - startedAt,
          error: {
            message: err2?.message ?? err1?.message ?? 'Unknown error',
            details: err2?.details ?? err1?.details ?? null
          }
        });
      }
    }
  } catch (err) {
    next(err);
  }
});
