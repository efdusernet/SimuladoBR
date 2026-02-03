import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import pg from 'pg';

const { Client } = pg;

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
  return arr.map((c) => String(c).split(';')[0].trim()).filter(Boolean);
}

function findCsrfToken(html) {
  const m = /name="_csrf"\s+value="([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

function findFreePort(startPort = 3201, attempts = 50) {
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
    }, 20_000);

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
    }, 300);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(new Error(`Server exited early with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });

  await ready;
  return {
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 400));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

async function getOrderPaymentInfo(databaseUrl, orderId) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select id, payment_method, status, payment_reference, payment_object_type, payment_url
       from orders where id = $1`,
      [orderId]
    );
    return rows[0] ?? null;
  } finally {
    await client.end().catch(() => {});
  }
}

function parseOrderIdFromRedirect(location) {
  const loc = String(location ?? '');
  const m = /[?&]order=([^&]+)/.exec(loc);
  if (!m) return null;
  return decodeURIComponent(m[1]);
}

async function runPaidFlow({ port, databaseUrl, accessApiKey, paymentMethod }) {
  const email = `asaas.${paymentMethod}.${Date.now()}@example.com`;

  // GET Home for CSRF + cookie ("/checkout" redirects to Home)
  const checkoutGet = await httpRequest({ port, method: 'GET', pathName: '/?focus=checkout' });
  if (checkoutGet.status !== 200) throw new Error(`/ GET expected 200, got ${checkoutGet.status}`);

  const csrfToken = findCsrfToken(checkoutGet.body);
  if (!csrfToken) throw new Error('Could not find CSRF token in /checkout HTML.');

  const cookies = extractCookies(checkoutGet.headers['set-cookie']);
  const cookieHeader = cookies.join('; ');

  // POST checkout with a paid plan
  const form = new URLSearchParams({
    _csrf: csrfToken,
    firstName: 'Asaas',
    lastName: 'Smoke',
    email,
    cpfCnpj: '39053344705',
    planId: 'essencial_pmp',
    paymentMethod
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
    throw new Error(`/checkout POST expected 302 redirect, got ${checkoutPost.status}. Body: ${checkoutPost.body.slice(0, 200)}`);
  }

  const orderId = parseOrderIdFromRedirect(checkoutPost.headers.location);
  if (!orderId) throw new Error(`Could not parse order id from redirect: ${checkoutPost.headers.location}`);

  // Confirm order has payment info
  const info = await getOrderPaymentInfo(databaseUrl, orderId);
  if (!info?.payment_reference) throw new Error(`Order ${orderId} missing payment_reference`);

  // Simulate webhook "paid"
  const webhookPayload = {
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: info.payment_object_type === 'paymentLink' ? null : info.payment_reference,
      status: 'CONFIRMED',
      invoiceUrl: info.payment_url ?? null
    },
    paymentLink: info.payment_object_type === 'paymentLink' ? info.payment_reference : null
  };

  const webhookRes = await httpRequest({
    port,
    method: 'POST',
    pathName: '/webhooks/asaas',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(webhookPayload)
  });

  if (webhookRes.status !== 200) {
    throw new Error(`/webhooks/asaas expected 200, got ${webhookRes.status}. Body: ${webhookRes.body.slice(0, 200)}`);
  }

  // Validate timeline row was recorded (best-effort; only if V2 table exists)
  try {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const { rows: evRows } = await client.query(
      `select count(*)::int as n from payment_events where order_id = $1`,
      [orderId]
    );
    const n = evRows?.[0]?.n ?? 0;
    if (n <= 0) throw new Error('no events recorded');
    await client.end().catch(() => {});
  } catch (e) {
    throw new Error(`Expected payment_events row after webhook, but verification failed: ${e?.message ?? String(e)}`);
  }

  // Validate access
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
  if (!parsed.access.endsAt) throw new Error(`Expected endsAt for paid plan, got: ${access.body}`);

  return {
    paymentMethod,
    orderId,
    paymentUrl: info.payment_url ?? null,
    paymentReference: info.payment_reference,
    paymentObjectType: info.payment_object_type,
    email,
    access: parsed.access
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const accessApiKey = process.env.ACCESS_API_KEY;

  if (!databaseUrl) throw new Error('DATABASE_URL not set in .env');
  if (!accessApiKey) throw new Error('ACCESS_API_KEY not set in .env');

  if (!process.env.ASAAS_API_KEY) {
    throw new Error('ASAAS_API_KEY not set in .env (required for Asaas smoke test).');
  }

  const port = await findFreePort(3201);
  const server = await startServer({ port });

  try {
    // Sanity ping
    const ping = await httpRequest({ port, method: 'GET', pathName: '/debug/asaas/ping' });
    if (ping.status !== 200) throw new Error(`/debug/asaas/ping expected 200, got ${ping.status}`);

    const results = [];
    for (const paymentMethod of ['pix', 'boleto', 'credit_card']) {
      results.push(await runPaidFlow({ port, databaseUrl, accessApiKey, paymentMethod }));
    }

    process.stdout.write('SMOKE ASAAS OK\n');
    process.stdout.write(`- Port: ${port}\n`);
    for (const r of results) {
      process.stdout.write(`- ${r.paymentMethod}: order=${r.orderId} ref=${r.paymentReference} type=${r.paymentObjectType}\n`);
      if (r.paymentUrl) process.stdout.write(`  paymentUrl: ${r.paymentUrl}\n`);
      process.stdout.write(`  email: ${r.email}\n`);
    }
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n');
  process.exit(1);
});
