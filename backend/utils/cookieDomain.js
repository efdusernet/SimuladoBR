function getRequestHostname(req) {
  try {
    const host = String((req && req.get && req.get('host')) || (req && req.headers && req.headers.host) || '').trim();
    return host.replace(/:\d+$/, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

// NOTE about localhost cookie domains:
// Many browsers reject cookies that set Domain=localhost or Domain=.localhost.
// When rejected, the cookie is not stored/sent, which breaks flows such as CSRF
// (double-submit cookie pattern) and makes login fail with "CSRF token missing".
//
// Therefore, in development we prefer host-only cookies (no Domain attribute).
// This is the most reliable behavior across Chrome/Edge/Firefox.
function getCookieDomainForRequest(req) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProd) {
    const override = String(process.env.COOKIE_DOMAIN || '').trim();
    return override || undefined;
  }

  // In dev, always return undefined to keep cookies host-only.
  return undefined;
}

module.exports = {
  getCookieDomainForRequest,
};
