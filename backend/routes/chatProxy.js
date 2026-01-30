const express = require('express');
const requireUserSession = require('../middleware/requireUserSession');
const requireAdmin = require('../middleware/requireAdmin');
const db = require('../models');
const { unauthorized, forbidden, serviceUnavailable } = require('../middleware/errors');
const path = require('path');
const dotenv = require('dotenv');

const router = express.Router();

const premiumCache = new Map();

// Optional: embed chat-service inside this backend process.
// This allows keeping the existing /chat/* URLs working without a separate :4010 process.
const CHAT_SERVICE_EMBED = String(process.env.CHAT_SERVICE_EMBED || process.env.CHAT_SERVICE_EMBEDDED || '').trim().toLowerCase() === 'true';
let _embeddedChatApp = null;
let _embeddedChatAppInitError = null;

function mergeEnvFromFileIfBlank(envFilePath) {
	try {
		const fs = require('fs');
		if (!envFilePath) return;
		if (!fs.existsSync(envFilePath)) return;
		const result = dotenv.config({ path: envFilePath });
		if (result && result.parsed) {
			for (const [key, value] of Object.entries(result.parsed)) {
				const current = process.env[key];
				if (current == null || String(current).trim() === '') {
					process.env[key] = String(value);
				}
			}
		}
	} catch (_) {
		// best-effort only
	}
}

function getEmbeddedChatApp() {
	if (!CHAT_SERVICE_EMBED) return null;
	if (_embeddedChatApp) return _embeddedChatApp;
	if (_embeddedChatAppInitError) return null;
	try {
		// Ensure chat-service/.env is loaded (its own env loader would read backend/.env due to cwd).
		mergeEnvFromFileIfBlank(path.resolve(__dirname, '..', '..', 'chat-service', '.env'));
		const { createApp } = require('../../chat-service/src/app');
		_embeddedChatApp = createApp();
		return _embeddedChatApp;
	} catch (e) {
		_embeddedChatAppInitError = e;
		return null;
	}
}

function cacheGet(key) {
	const hit = premiumCache.get(key);
	if (!hit) return null;
	if (hit.expiresAt <= Date.now()) {
		premiumCache.delete(key);
		return null;
	}
	return hit;
}

function cacheSet(key, value, ttlMs) {
	premiumCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function requirePremium(req, res, next) {
	try {
		// Allow health checks without auth/premium
		if (req.method === 'GET' && (req.path === '/health' || req.path === '/health/')) return next();

		// Resolve user session (cookie/header/jwt)
		await new Promise((resolve, reject) => {
			let settled = false;
			function done(err) {
				settled = true;
				return err ? reject(err) : resolve();
			}
			Promise.resolve(requireUserSession(req, res, done))
				.then(() => {
					// If middleware returned early without calling next(), avoid hanging.
					if (!settled) resolve();
				})
				.catch(reject);
		});

		// If requireUserSession already produced a response (e.g., 401), stop here.
		if (res.headersSent) return;

		const userId = req.user && req.user.id;
		if (!userId) return next(unauthorized('Session token required', 'SESSION_TOKEN_REQUIRED'));

		// Use session token as cache key (preferred), fallback to user id
		const tokenKey = String((req.cookies && req.cookies.sessionToken) || req.get('X-Session-Token') || userId);
		const cached = cacheGet(tokenKey);
		if (cached) {
			if (cached.value === true) return next();
			return next(forbidden('Premium required', 'PREMIUM_REQUIRED'));
		}

		const user = await db.User.findByPk(Number(userId));
		if (!user) {
			cacheSet(tokenKey, false, 30_000);
			return next(unauthorized('User not found', 'USER_NOT_FOUND'));
		}

		const isPremium = user.BloqueioAtivado === false;
		cacheSet(tokenKey, isPremium, 60_000);
		if (!isPremium) return next(forbidden('Premium required', 'PREMIUM_REQUIRED'));
		return next();
	} catch (e) {
		return next(e);
	}
}

function requireChatAccess(req, res, next) {
	// Allow health checks without auth/premium
	if (req.method === 'GET' && (req.path === '/health' || req.path === '/health/')) return next();

	// Public widget assets must always be loadable (script tag expects JS MIME type).
	if (req.method === 'GET' && (req.path === '/widget' || req.path.startsWith('/widget/'))) return next();

	// Public widget bootstrap data
	if (req.method === 'GET' && (req.path === '/v1/support-topics' || req.path === '/v1/support-topics/')) return next();

	// Public chat conversation flow (visitor-based). The chat-service itself enforces rate limits.
	if (req.path === '/v1/conversations' || req.path.startsWith('/v1/conversations/')) return next();

	const p = String(req.path || '');
	// IMPORTANT: When the chat-service is mounted under /chat (proxy or embedded),
	// the admin panel authenticates using its own token model (Authorization: Bearer <token>).
	// Do NOT gate it with SimuladosBR's requireAdmin, otherwise the chat panel login is blocked.
	if (p === '/admin' || p.startsWith('/admin/') || p === '/v1/admin' || p.startsWith('/v1/admin/')) {
		return next();
	}
	// Default: premium-only access
	return requirePremium(req, res, next);
}

function getChatServiceBaseUrl() {
	const raw = process.env.CHAT_SERVICE_BASE_URL || process.env.CHAT_SERVICE_URL || '';
	return String(raw || '').trim().replace(/\/$/, '');
}

function isHopByHopHeader(name) {
	const h = String(name || '').toLowerCase();
	return (
		h === 'connection' ||
		h === 'keep-alive' ||
		h === 'proxy-authenticate' ||
		h === 'proxy-authorization' ||
		h === 'te' ||
		h === 'trailer' ||
		h === 'transfer-encoding' ||
		h === 'upgrade'
	);
}

function toUpstreamHeaders(req) {
	const headers = {};
	for (const [key, value] of Object.entries(req.headers || {})) {
		if (!key) continue;
		if (isHopByHopHeader(key)) continue;
		// Avoid upstream CORS checks when calling via same-origin reverse proxy
		// (chat-service enforces allowed origins and can reject http://localhost:3000).
		if (String(key).toLowerCase() === 'origin') continue;
		if (String(key).toLowerCase() === 'referer') continue;
		// Never leak SimuladosBR auth to upstream.
		if (String(key).toLowerCase() === 'x-session-token') continue;
		if (String(key).toLowerCase() === 'cookie') continue;
		if (String(key).toLowerCase() === 'host') continue;
		if (String(key).toLowerCase() === 'content-length') continue;
		if (value == null) continue;
		headers[key] = value;
	}
	return headers;
}

function buildBody(req) {
	if (req.method === 'GET' || req.method === 'HEAD') return undefined;

	// express.json() already parsed the body.
	if (req.body == null) return undefined;

	// If body is a Buffer or string, pass through.
	if (Buffer.isBuffer(req.body)) return req.body;
	if (typeof req.body === 'string') return req.body;

	// Default to JSON.
	return JSON.stringify(req.body);
}

function rewriteLocationHeader(value) {
	const raw = value == null ? '' : String(value);
	if (!raw) return raw;
	// When chat-service responds with redirects like Location: /admin/ (root-based),
	// keep navigation under the /chat reverse-proxy mount.
	try {
		if (/^https?:\/\//i.test(raw)) {
			const u = new URL(raw);
			if (String(u.pathname || '').startsWith('/chat/')) return u.pathname + u.search + u.hash;
			return '/chat' + u.pathname + u.search + u.hash;
		}
		if (raw.startsWith('/')) {
			if (raw.startsWith('/chat/')) return raw;
			return '/chat' + raw;
		}
		// Relative redirects (e.g., "./" or "panel") are already resolved relative
		// to the current /chat/... URL in the browser.
		return raw;
	} catch (_) {
		if (raw.startsWith('/')) {
			if (raw.startsWith('/chat/')) return raw;
			return '/chat' + raw;
		}
		return raw;
	}
}

async function proxyToChatService(req, res, next) {
	try {
		const embedded = getEmbeddedChatApp();
		if (embedded) {
			return embedded(req, res);
		}

		const base = getChatServiceBaseUrl();
		if (!base) {
			return next(
				serviceUnavailable(
					'CHAT_SERVICE_BASE_URL não configurada no backend',
					'CHAT_SERVICE_UNCONFIGURED'
				)
			);
		}

		// router is mounted at /chat, so req.url starts with /...
		const upstream = new URL(req.url, `${base}/`);
		// Do not leak SimuladosBR auth token to upstream in query string.
		upstream.searchParams.delete('sessionToken');
		const upstreamUrl = upstream.toString();
		const headers = toUpstreamHeaders(req);
		const body = buildBody(req);

		// Ensure JSON content-type if we are sending a JSON string but no explicit content-type.
		if (body != null) {
			const ct = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
			if (!ct) headers['Content-Type'] = 'application/json; charset=utf-8';
		}

		const upstreamResp = await fetch(upstreamUrl, {
			method: req.method,
			headers,
			body,
			redirect: 'manual',
		});

		res.status(upstreamResp.status);
		upstreamResp.headers.forEach((value, key) => {
			if (isHopByHopHeader(key)) return;
			// Let express set its own content-length.
			if (String(key).toLowerCase() === 'content-length') return;
			if (String(key).toLowerCase() === 'location') {
				res.setHeader(key, rewriteLocationHeader(value));
				return;
			}
			res.setHeader(key, value);
		});

		const buf = Buffer.from(await upstreamResp.arrayBuffer());
		return res.send(buf);
	} catch (err) {
		return next(err);
	}
}

// Root (non-proxied)
router.get('/', (req, res) => res.json({ ok: true, proxy: 'chat-service', mountedAt: '/chat' }));

// Catch-all proxy (widget + public/admin APIs)
router.use(requireChatAccess);
router.use(proxyToChatService);

module.exports = router;
