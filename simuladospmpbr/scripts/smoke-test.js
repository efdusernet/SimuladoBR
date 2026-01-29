import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function httpRequest({ port, method, pathName, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: pathName,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: buf.toString('utf8')
          });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function extractCookies(setCookieHeader) {
  if (!setCookieHeader) return [];
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean);
}

function findCsrfToken(html) {
  const m = /name="_csrf"\s+value="([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

function findFreePort(startPort = 3101, attempts = 50) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryNext = () => {
      if (attempts-- <= 0) return reject(new Error('No free port found'));

      const server = net.createServer();
      server.unref();
      server.on('error', () => {
        port += 1;
        tryNext();
      });
      server.listen({ host: '127.0.0.1', port }, () => {
        const chosen = port;
        server.close(() => resolve(chosen));
      });
    };

    tryNext();
  });
}

async function startServer({ port }) {
  const childEnv = {
    ...process.env,
    PORT: String(port),
    BASE_URL: `http://localhost:${port}`
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => {
    stdout += d.toString('utf8');
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not become ready.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 12_000);

    const interval = setInterval(async () => {
      try {
        const res = await httpRequest({ port, method: 'GET', pathName: '/healthz' });
        if (res.status >= 200 && res.status < 500) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      } catch {
        // not ready yet
      }
    }, 250);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(new Error(`Server exited early with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });

  await ready;
  return {
    child,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

async function main() {
  const accessApiKey = process.env.ACCESS_API_KEY;
  if (!accessApiKey) {
    throw new Error('ACCESS_API_KEY not set in .env (required for /api/v1/access smoke test).');
  }

  const port = await findFreePort(3101);
  const email = `smoke.${Date.now()}@example.com`;

  const server = await startServer({ port });

  try {
    // 1) /healthz
    const health = await httpRequest({ port, method: 'GET', pathName: '/healthz' });
    if (health.status !== 200) throw new Error(`/healthz expected 200, got ${health.status}`);

    // 2) Home (get CSRF + cookie)
    const homeGet = await httpRequest({ port, method: 'GET', pathName: '/' });
    if (homeGet.status !== 200) throw new Error(`/ GET expected 200, got ${homeGet.status}`);

    const csrfToken = findCsrfToken(homeGet.body);
    if (!csrfToken) throw new Error('Could not find CSRF token in Home HTML.');

    const cookies = extractCookies(homeGet.headers['set-cookie']);
    const cookieHeader = cookies.join('; ');

    // 3) POST /checkout with START (free)
    const form = new URLSearchParams({
      _csrf: csrfToken,
      firstName: 'Smoke',
      lastName: 'Test',
      email,
      planId: 'start',
      paymentMethod: 'pix'
    }).toString();

    const checkoutPost = await httpRequest({
      port,
      method: 'POST',
      pathName: '/checkout',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(form),
        cookie: cookieHeader
      },
      body: form
    });

    if (checkoutPost.status !== 302) {
      throw new Error(`/checkout POST expected 302 redirect for free plan, got ${checkoutPost.status}`);
    }

    const location = checkoutPost.headers.location;
    if (!location || !String(location).startsWith('/checkout/sucesso')) {
      throw new Error(`Expected redirect to /checkout/sucesso..., got Location='${location}'`);
    }

    // 4) Follow redirect
    const success = await httpRequest({ port, method: 'GET', pathName: String(location) });
    if (success.status !== 200) throw new Error(`Success page expected 200, got ${success.status}`);

    // 5) /api/v1/access should now be active
    const access = await httpRequest({
      port,
      method: 'GET',
      pathName: `/api/v1/access?email=${encodeURIComponent(email)}`,
      headers: {
        'x-access-api-key': accessApiKey
      }
    });

    if (access.status !== 200) throw new Error(`/api/v1/access expected 200, got ${access.status}`);

    let parsed;
    try {
      parsed = JSON.parse(access.body);
    } catch {
      throw new Error(`Could not parse /api/v1/access JSON. Body: ${access.body.slice(0, 200)}`);
    }

    if (!parsed?.ok || !parsed?.access) throw new Error(`Unexpected /api/v1/access response: ${access.body}`);
    if (parsed.access.active !== true) throw new Error(`Expected access.active=true, got: ${access.body}`);

    process.stdout.write('SMOKE OK\n');
    process.stdout.write(`- Port: ${port}\n`);
    process.stdout.write(`- Email: ${email}\n`);
    process.stdout.write(`- Plan: ${parsed.access.planId} (${parsed.access.planName})\n`);
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n');
  process.exit(1);
});
