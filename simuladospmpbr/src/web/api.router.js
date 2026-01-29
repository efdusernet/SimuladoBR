import { Router } from 'express';
import { config } from '../shared/config.js';
import { getActiveEntitlementByEmail } from '../db/commerce.repo.js';

export const apiRouter = Router();

apiRouter.get('/api/v1/access', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-access-api-key'];
    if (!config.accessApiKey || apiKey !== config.accessApiKey) {
      return res.status(401).json({ ok: false });
    }

    const email = String(req.query.email ?? '').trim();
    if (!email) {
      return res.status(400).json({ ok: false, error: 'email_required' });
    }

    const entitlement = await getActiveEntitlementByEmail(email);
    if (!entitlement) {
      return res.status(200).json({
        ok: true,
        access: {
          active: false
        }
      });
    }

    return res.status(200).json({
      ok: true,
      access: {
        active: true,
        planId: entitlement.plan_id,
        planName: entitlement.plan_name,
        startsAt: entitlement.starts_at,
        endsAt: entitlement.ends_at
      }
    });
  } catch (err) {
    next(err);
  }
});
