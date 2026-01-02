require('dotenv').config();

const { generateKeyPair, exportSPKI, SignJWT } = require('jose');

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: res.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!process.env.DATABASE_URL || String(process.env.DATABASE_URL).trim() === '') {
    throw new Error('DATABASE_URL is required in .env');
  }

  const port = Number(process.env.SMOKE_PORT || 4011);
  process.env.PORT = String(port);

  // Create JWT key pair & token
  const userId = 'smoke-user-1';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicKeyPem = await exportSPKI(publicKey);

  process.env.JWT_PUBLIC_KEY_PEM = publicKeyPem;
  process.env.JWT_ALGORITHMS = 'RS256';

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(privateKey);

  // Require app after env is set (env.js reads process.env at load time)
  const { createApp } = require('../src/app');

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });

  const base = `http://localhost:${port}`;

  try {
    // 1) No JWT: create conversation
    const createdAnon = await httpJson(`${base}/v1/conversations`, { method: 'POST', body: {} });
    assert(createdAnon.status === 200, `expected 200 create anon, got ${createdAnon.status}`);
    assert(createdAnon.json && createdAnon.json.ok === true, 'expected ok=true for anon create');

    const anonConversationId = createdAnon.json.conversationId;

    // 1a) Wrong visitorId should be forbidden
    const wrongVisitorId = '00000000-0000-0000-0000-000000000000';
    const forbidden = await httpJson(`${base}/v1/conversations/${anonConversationId}/messages`, {
      method: 'POST',
      headers: { 'X-Chat-Visitor-Id': wrongVisitorId },
      body: { role: 'user', text: 'should fail' },
    });
    assert(forbidden.status === 403, `expected 403 wrong visitor, got ${forbidden.status}`);

    // 2) Invalid JWT should be 401
    const invalidJwt = await httpJson(`${base}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-jwt' },
      body: {},
    });
    assert(invalidJwt.status === 401, `expected 401 invalid jwt, got ${invalidJwt.status}`);

    // 3) With JWT: create conversation bound to userId
    const createdAuth = await httpJson(`${base}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    assert(createdAuth.status === 200, `expected 200 create auth, got ${createdAuth.status}`);
    assert(createdAuth.json && createdAuth.json.ok === true, 'expected ok=true for auth create');

    const authConversationId = createdAuth.json.conversationId;

    // 3a) Send message with mismatched visitorId but valid JWT should succeed
    const sendWithJwt = await httpJson(`${base}/v1/conversations/${authConversationId}/messages`, {
      method: 'POST',
      headers: {
        'X-Chat-Visitor-Id': wrongVisitorId,
        Authorization: `Bearer ${token}`,
      },
      body: { role: 'user', text: 'jwt ok' },
    });
    assert(sendWithJwt.status === 200, `expected 200 send with jwt, got ${sendWithJwt.status}`);
    assert(sendWithJwt.json && sendWithJwt.json.ok === true, 'expected ok=true for send with jwt');

    // 3b) List messages with mismatched visitorId but valid JWT should succeed
    const listWithJwt = await httpJson(`${base}/v1/conversations/${authConversationId}/messages`, {
      method: 'GET',
      headers: {
        'X-Chat-Visitor-Id': wrongVisitorId,
        Authorization: `Bearer ${token}`,
      },
    });
    assert(listWithJwt.status === 200, `expected 200 list with jwt, got ${listWithJwt.status}`);
    assert(listWithJwt.json && listWithJwt.json.ok === true, 'expected ok=true for list with jwt');
    assert(Array.isArray(listWithJwt.json.messages), 'expected messages array');

    // eslint-disable-next-line no-console
    console.log('[smokeAuth] OK', {
      anonConversationId,
      authConversationId,
      messagesCount: listWithJwt.json.messages.length,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[smokeAuth] failed', err);
  process.exitCode = 1;
});
