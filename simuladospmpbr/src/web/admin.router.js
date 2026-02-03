import { Router } from 'express';
import csrf from 'csurf';
import { z } from 'zod';

import { config } from '../shared/config.js';
import { authenticateAdminUser, getAdminCookieOptions } from '../db/adminUsers.repo.js';
import { createAdminSession, generateSessionToken, getClientIp, getUserAgent, revokeAdminSessionByToken } from '../db/adminSessions.repo.js';

export const adminRouter = Router();

const csrfProtection = csrf({ cookie: { key: config.csrfCookieName, sameSite: 'lax' } });

function safeReturnTo(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (!s.startsWith('/admin')) return null;
  return s;
}

adminRouter.get('/admin/login', csrfProtection, (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo) || '/admin/finance';
  return res.status(200).render('pages/admin_login', {
    title: 'Login — Admin',
    csrfToken: req.csrfToken(),
    returnTo,
    error: null,
    form: { email: '' }
  });
});

adminRouter.post('/admin/login', csrfProtection, async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
      password: z.string().min(1),
      returnTo: z.string().optional()
    });

    const parsed = schema.safeParse(req.body);
    const returnTo = safeReturnTo(req.body?.returnTo) || '/admin/finance';

    if (!parsed.success) {
      return res.status(400).render('pages/admin_login', {
        title: 'Login — Admin',
        csrfToken: req.csrfToken(),
        returnTo,
        error: 'Verifique os campos e tente novamente.',
        form: { email: String(req.body?.email || '') }
      });
    }

    const auth = await authenticateAdminUser({ email: parsed.data.email, password: parsed.data.password });
    if (!auth.ok) {
      return res.status(401).render('pages/admin_login', {
        title: 'Login — Admin',
        csrfToken: req.csrfToken(),
        returnTo,
        error: 'Credenciais inválidas.',
        form: { email: parsed.data.email }
      });
    }

    const token = generateSessionToken();
    await createAdminSession({
      userId: auth.user.id,
      token,
      ttlDays: 14,
      ip: getClientIp(req),
      userAgent: getUserAgent(req)
    });

    res.cookie('admin_session', token, getAdminCookieOptions());

    return res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/admin/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.admin_session ? String(req.cookies.admin_session) : null;
    if (token) await revokeAdminSessionByToken({ token });
    res.clearCookie('admin_session', { path: '/' });
    return res.redirect('/');
  } catch (err) {
    next(err);
  }
});
