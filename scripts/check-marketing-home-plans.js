const http = require('http');

function fetch(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        path,
        method: 'GET',
        headers: { 'User-Agent': 'simuladosbr-local-check/1.0' },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.setTimeout(4000, () => {
      req.destroy(new Error('Request timed out (is the backend running on http://localhost:3001?)'));
    });
    req.on('error', reject);
    req.end();
  });
}

function countMatches(haystack, regex) {
  const m = haystack.match(regex);
  return m ? m.length : 0;
}

(async () => {
  let status;
  let headers;
  let body;
  let usedPort;
  try {
    usedPort = Number(process.env.PORT || 3000);
    ({ status, headers, body } = await fetch(usedPort, '/'));
  } catch (err) {
    // Fallback: some setups used 3001 historically.
    try {
      usedPort = 3001;
      ({ status, headers, body } = await fetch(usedPort, '/'));
    } catch (err2) {
      const message = err2 && err2.message ? err2.message : String(err2);
      console.error('ERR', message);
      if (err2 && err2.name) console.error('ERR_NAME', err2.name);
      if (err2 && err2.code) console.error('ERR_CODE', err2.code);
      if (err2 && err2.errors && Array.isArray(err2.errors)) {
        console.error('ERR_INNER_COUNT', err2.errors.length);
        for (const e of err2.errors.slice(0, 5)) {
          console.error('ERR_INNER', e && e.message ? e.message : String(e));
        }
      }
      process.exitCode = 2;
      return;
    }
  }

  const has = (id) => new RegExp(`data-plan-id=\\"${id}\\"`).test(body);

  const featuredPro90 =
    /class=\"[^\"]*pricing-card--featured[^\"]*\"[^>]*data-plan-id=\"pro-90\"/.test(body) ||
    /data-plan-id=\"pro-90\"[^>]*class=\"[^\"]*pricing-card--featured[^\"]*\"/.test(body);

  const cards = countMatches(body, /class=\"pricing-card /g);

  const planIds = ['start', 'pro-30', 'pro-60', 'pro-90', 'pro-120', 'pro-180'];
  const missing = planIds.filter((id) => !has(id));

  console.log('status', status);
  console.log('port', usedPort);
  console.log('x-route', headers['x-simuladosbr-route'] || '');
  console.log('x-file', headers['x-simuladosbr-file'] || '');
  console.log('cards', cards);
  console.log('missing', missing.length ? missing.join(', ') : '(none)');
  console.log('featured pro-90', featuredPro90);

  // quick sanity that checkout select list also contains the new plans
  const checkoutOptions = countMatches(body, /<option value=\"(start|pro-30|pro-60|pro-90|pro-120|pro-180)\"/g);
  console.log('checkout options (recognized ids)', checkoutOptions);

  // sanity: admin endpoint should exist (will redirect/deny without auth, but must not be 404)
  try {
    const adminRes = await fetch(usedPort, '/api/admin/product-plans');
    console.log('admin endpoint status', adminRes.status);
    if (adminRes.status === 404) process.exitCode = 5;
  } catch (e) {
    console.log('admin endpoint status', '(error)');
  }

  if (status !== 200) process.exitCode = 2;
  if (missing.length) process.exitCode = 3;
  if (!featuredPro90) process.exitCode = 4;
})();
