import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});
