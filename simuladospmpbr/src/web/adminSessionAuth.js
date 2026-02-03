import { getAdminUserBySessionToken } from '../db/adminSessions.repo.js';

function safeReturnTo(req) {
  const path = String(req.originalUrl || '').trim();
  if (!path.startsWith('/admin')) return '/admin/finance';
  return path;
}

export async function requireAdminSession(req, res, next) {
  try {
    const token = req.cookies?.admin_session ? String(req.cookies.admin_session) : null;
    if (!token) {
      const returnTo = encodeURIComponent(safeReturnTo(req));
      return res.redirect(`/admin/login?returnTo=${returnTo}`);
    }

    const user = await getAdminUserBySessionToken({ token });
    if (!user) {
      res.clearCookie('admin_session', { path: '/' });
      const returnTo = encodeURIComponent(safeReturnTo(req));
      return res.redirect(`/admin/login?returnTo=${returnTo}`);
    }

    req.adminUser = user.email;
    req.adminUserId = user.id;
    res.locals.adminUser = user.email;
    res.locals.adminRole = user.role;

    return next();
  } catch (err) {
    return next(err);
  }
}
