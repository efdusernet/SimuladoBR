const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const http = require('http');
const httpProxy = require('http-proxy');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dotenv = require('dotenv');
const { getCookieDomainForRequest } = require('./utils/cookieDomain');

// Load backend/.env explicitly (independent of process.cwd())
// and override only OLLAMA_* keys so timeouts don't get stuck due to
// previously-set Windows/terminal environment variables.
const dotenvResult = dotenv.config({ path: path.resolve(__dirname, '.env') });
if (dotenvResult && dotenvResult.parsed) {
	for (const [key, value] of Object.entries(dotenvResult.parsed)) {
		if (key && key.startsWith('OLLAMA_')) {
			process.env[key] = String(value);
		}
		// dotenv does not override existing env vars by default; on Windows it's common
		// to have a variable defined but empty, which would incorrectly disable features.
		// For chat proxy, prefer backend/.env value when the current env value is blank.
		if (key === 'CHAT_SERVICE_BASE_URL' || key === 'CHAT_SERVICE_URL') {
			const current = process.env[key];
			if (current == null || String(current).trim() === '') {
				process.env[key] = String(value);
			}
		}
	}
}

// Initialize structured logging system
const { logger } = require('./utils/logger');
const { requestLogger, errorLogger } = require('./middleware/logging');
const { AppError, errorHandler } = require('./middleware/errorHandler');

// Validate security configuration early (will exit if JWT_SECRET invalid)
require('./config/security');

const app = express();

// API responses should not be cached in browsers/proxies; caching can lead to 304 responses
// which break some client-side auth/admin probes.
app.set('etag', false);

// Optional: embed chat-service inside this backend (no separate :4010 process)
const CHAT_SERVICE_EMBED = String(process.env.CHAT_SERVICE_EMBED || process.env.CHAT_SERVICE_EMBEDDED || '').trim().toLowerCase() === 'true';
const CHAT_SERVICE_HOST = String(process.env.CHAT_SERVICE_HOST || 'chat.localhost').trim().toLowerCase();
let chatEmbeddedApp = null;
let chatEmbeddedWs = null;

function mergeEnvFromFileIfBlank(envFilePath) {
	try {
		const fsLocal = require('fs');
		if (!envFilePath) return;
		if (!fsLocal.existsSync(envFilePath)) return;
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

if (CHAT_SERVICE_EMBED) {
	// In embedded mode, chat-service's env loader would otherwise read backend/.env (cwd).
	// We load chat-service/.env explicitly and only fill missing/blank variables.
	mergeEnvFromFileIfBlank(path.resolve(__dirname, '..', 'chat-service', '.env'));
	try {
		const { createApp } = require('../chat-service/src/app');
		chatEmbeddedApp = createApp();
		logger.info('Chat-service embedded mode enabled', { host: CHAT_SERVICE_HOST });
	} catch (e) {
		logger.warn('Chat-service embedded mode failed to initialize', { error: e && e.message ? String(e.message) : 'unknown' });
		chatEmbeddedApp = null;
	}
}

function getChatServiceBaseUrl() {
	const raw = process.env.CHAT_SERVICE_BASE_URL || process.env.CHAT_SERVICE_URL || '';
	return String(raw || '').trim().replace(/\/$/, '');
}

const chatWsProxy = httpProxy.createProxyServer({
	ws: true,
	changeOrigin: true,
	secure: false,
});

chatWsProxy.on('error', (err, req, socket) => {
	try {
		const msg = (err && err.message) ? String(err.message) : 'proxy error';
		logger.warn('chat ws proxy error', { message: msg });
	} catch {}
	try { socket.destroy(); } catch {}
});

// API versioning
const API_BASE = '/api';
const API_V1 = '/api/v1';

// Request ID tracking - must be first
// Request ID middleware
app.use((req, res, next) => {
	const id = req.get('X-Request-Id') || uuidv4();
	res.set('X-Request-Id', id);
	req.id = id;
	next();
});

// HTTP request logging
app.use(requestLogger);

// HTTP Compression (gzip/brotli) - must be before routes
app.use(compression({
  // Filter function to determine what should be compressed
  filter: (req, res) => {
    // Don't compress responses with x-no-compression header
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Skip compression for already-compressed content types
    const contentType = res.getHeader('Content-Type');
    if (contentType && (
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('audio/') ||
      contentType.includes('application/zip') ||
      contentType.includes('application/gzip')
    )) {
      return false;
    }
    // Use compression filter for everything else
    return compression.filter(req, res);
  },
  // Compression level: 6 balances speed and compression ratio
  level: 6,
  // Only compress responses larger than 1KB
  threshold: 1024,
  // Memory level for compression (1-9, higher = more memory, better compression)
  memLevel: 8
}));

// Security headers (CSP disabled initially to avoid breaking inline assets; can be tightened later)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS configuration with credentials support for cookies
// Note: when frontend+backend are served from the same origin (recommended), CORS is not used by browsers.
// We still keep a safe allowlist here for cases where a separate dev origin is used.
app.use(cors({
	origin: (origin, callback) => {
		// Non-browser clients (curl/Postman) often omit Origin.
		if (!origin) return callback(null, true);
		const originStr = String(origin || '').trim();

		const allowlist = new Set();
		if (process.env.FRONTEND_URL) allowlist.add(String(process.env.FRONTEND_URL));

		const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
		// Some environments send Origin: null (e.g. file://, sandboxed iframes, some extensions)
		// Allow it only during development.
		if (!isProd && originStr.toLowerCase() === 'null') return callback(null, true);
		if (!isProd) {
			// Common dev origins
			allowlist.add('http://localhost:3000');
			allowlist.add('http://app.localhost:3000');
		}

		if (allowlist.has(originStr)) return callback(null, true);

		if (!isProd) {
			// Accept any localhost / *.localhost origin during development.
			try {
				const u = new URL(origin);
				const h = String(u.hostname || '').toLowerCase();
				if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1') {
					return callback(null, true);
				}
			} catch (_) {}
		}

		return callback(new Error(`Not allowed by CORS: ${originStr}`));
	},
	credentials: true
}));

// Cookie parser for reading httpOnly cookies
app.use(cookieParser());

// CSRF Protection middleware
const { attachCsrfToken, csrfProtection } = require('./middleware/csrfProtection');
app.use(attachCsrfToken);

// Increase JSON body limit to 10MB to support base64 images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Conexão com DB e modelos
const db = require('./models');
const sequelize = db.sequelize;

sequelize.authenticate()
	.then(() => logger.info('Database connected successfully'))
	.catch(err => {
		logger.error('Database connection failed', { error: err.message, stack: err.stack });
		process.exit(1);
	});

// Opcional: sincroniza modelos com o banco quando DB_SYNC=true
if (process.env.DB_SYNC === 'true') {
	sequelize.sync({ alter: true })
		.then(() => logger.info('Database models synchronized (alter mode)'))
		.catch(err => logger.error('Error synchronizing models', { error: err.message, stack: err.stack }));
}

// Rotas
// Basic API rate limiting (apply to both legacy and versioned paths)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use(`${API_V1}/`, apiLimiter);
app.use(`${API_BASE}/`, apiLimiter);

// API version response headers and legacy deprecation notice
app.use(`${API_V1}`, (req, res, next) => {
	res.set('X-API-Version', '1');
	next();
});
// Mark unversioned API as deprecated but keep it working
app.use(`${API_BASE}`, (req, res, next) => {
	// If the request is actually for a versioned route under /api, skip deprecation header
	if (req.originalUrl && req.originalUrl.startsWith(`${API_V1}`)) return next();
	res.set('X-API-Version', '0');
	res.set('Deprecation', 'true');
	// Optional: planned removal date can be overridden via env var
	const sunset = process.env.API_V0_SUNSET || '2026-03-01T00:00:00Z';
	res.set('Sunset', sunset);
	res.set('Link', '</api/v1>; rel="successor-version"');
	next();
});

// Serve frontend estático: sirva dist (se existir) primeiro para assets otimizados,
// mas mantenha a pasta frontend como fallback para HTML e demais arquivos.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const fs = require('fs');
const { createProductSite } = require('./productSite');

function getHostname(req) {
	try {
		const raw = String(req.get('host') || '');
		return raw.split(':')[0].trim().toLowerCase();
	} catch (_) {
		return '';
	}
}

function isChatHost(req) {
	try {
		return getHostname(req) === CHAT_SERVICE_HOST;
	} catch (_) {
		return false;
	}
}

function isLocalhostHost(req) {
	const h = getHostname(req);
	return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function setNoCacheHeaders(res) {
	try {
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Expires', '0');
	} catch (_) {}
}

// Never cache API responses (prevents intermittent 304 and stale auth/admin state)
app.use('/api', (req, res, next) => {
	setNoCacheHeaders(res);
	return next();
});
app.use('/api/v1', (req, res, next) => {
	setNoCacheHeaders(res);
	return next();
});

// Product home (localhost:3000) - served from the imported simuladospmpbr project.
const PRODUCT_ROOT = path.join(__dirname, '..', 'simuladospmpbr');
const productSite = createProductSite({
	productRoot: PRODUCT_ROOT,
	getCsrfToken: (req) => {
		try {
			return (typeof req.csrfToken === 'function') ? req.csrfToken() : '';
		} catch (_) {
			return '';
		}
	},
});

// Mount product home only for localhost host.
app.use((req, res, next) => {
	try {
		if (!isLocalhostHost(req)) return next();
		// Don't hijack API or chat proxy routes on localhost.
		if (req.path && (req.path === '/api' || req.path.startsWith('/api/'))) return next();
		if (req.path && (req.path === '/api/v1' || req.path.startsWith('/api/v1/'))) return next();
		if (req.path && req.path.startsWith('/chat/')) return next();

		// If a sessionToken arrives on localhost, it must be set on the app origin.
		if (req.method === 'GET' && req.query && req.query.sessionToken) {
			try {
				const original = String(req.originalUrl || req.url || '/');
				const u = new URL(original, 'http://localhost');
				const token = String(u.searchParams.get('sessionToken') || '').trim();
				u.searchParams.delete('sessionToken');
				// Put token in fragment so it is not sent to server/logs/referrer.
				const frag = token ? ('sessionToken=' + encodeURIComponent(token)) : '';
				const target = `http://app.localhost:3000${u.pathname}${u.search}${frag ? ('#' + frag) : ''}`;
				return res.redirect(302, target);
			} catch (_) {
				const target = `http://app.localhost:3000${req.path || '/'}`;
				return res.redirect(302, target);
			}
		}

		// If simulator-specific paths are requested on localhost, redirect to app.localhost.
		if (req.method === 'GET') {
			const p = String(req.path || '');
			const isSimulatorPath = (
				p === '/login' ||
				p === '/login.html' ||
				p.startsWith('/pages/') ||
				p.startsWith('/utils/') ||
				/^\/script.*\.js$/i.test(p) ||
				p === '/manifest.json' ||
				p === '/sw.js' ||
				p === '/offline.html'
			);
			if (isSimulatorPath) {
				const target = `http://app.localhost:3000${req.originalUrl || req.url || '/'}`;
				return res.redirect(302, target);
			}
		}

		setNoCacheHeaders(res);
		return productSite(req, res, next);
	} catch (_) {
		return next();
	}
});

// IMPORTANT: when dist exists, it can contain stale copies of critical exam scripts/pages.
// Always serve these from the source frontend/ folder to avoid mismatched client logic.
// (This also makes debugging and hotfixes reliable.)
app.get('/script_exam.js', (req, res) => {
	setNoCacheHeaders(res);
	try { res.setHeader('X-Served-From', 'frontend-src'); } catch(_){ }
	return res.sendFile(path.join(FRONTEND_DIR, 'script_exam.js'));
});
app.get('/utils/matchColumns.js', (req, res) => {
	setNoCacheHeaders(res);
	try { res.setHeader('X-Served-From', 'frontend-src'); } catch(_){ }
	return res.sendFile(path.join(FRONTEND_DIR, 'utils', 'matchColumns.js'));
});
app.get('/pages/exam.html', (req, res) => {
	setNoCacheHeaders(res);
	try { res.setHeader('X-Served-From', 'frontend-src'); } catch(_){ }
	return res.sendFile(path.join(FRONTEND_DIR, 'pages', 'exam.html'));
});
app.get('/pages/examFull.html', (req, res) => {
	setNoCacheHeaders(res);
	try { res.setHeader('X-Served-From', 'frontend-src'); } catch(_){ }
	return res.sendFile(path.join(FRONTEND_DIR, 'pages', 'examFull.html'));
});

// IMPORTANT: serve sidebar component from frontend/ source to avoid stale dist copies.
// This page is fetched dynamically by layoutManager and must reflect the latest admin/auth logic.
app.get('/components/sidebar.html', (req, res) => {
	setNoCacheHeaders(res);
	try { res.setHeader('X-Served-From', 'frontend-src'); } catch(_){ }
	try {
		const fsLocal = require('fs');
		const filePath = path.join(FRONTEND_DIR, 'components', 'sidebar.html');
		const st = fsLocal.statSync(filePath);
		res.setHeader('X-SimuladosBR-Static-File', path.basename(filePath));
		res.setHeader('X-SimuladosBR-Static-Mtime', st && st.mtime ? st.mtime.toISOString() : '');
		res.setHeader('X-SimuladosBR-Static-Size', st && typeof st.size === 'number' ? String(st.size) : '');
	} catch(_){ }

	// Keep behavior consistent with the global auth-redirect middleware:
	// - Product site on localhost is public and should not serve app components.
	// - IMPORTANT: do NOT force /login here; the app may authenticate via headers/localStorage.
	try {
		if (isLocalhostHost(req)) {
			const target = `http://app.localhost:3000${req.originalUrl || req.url || '/components/sidebar.html'}`;
			return res.redirect(302, target);
		}
	} catch (_e) { /* ignore */ }

	// Serve a patched sidebar HTML to avoid "stale sidebar" issues (Known Issues: served file != editor code)
	// and to make Admin gating deterministic on dynamically-injected pages like InsightsIA.
	try {
		const fsLocal = require('fs');
		const filePath = path.join(FRONTEND_DIR, 'components', 'sidebar.html');
		let html = fsLocal.readFileSync(filePath, 'utf8');

		// Bump a visible marker so we can confirm what the browser received.
		html = html.replace(
			/data-sidebar-version="[^"]*"/,
			'data-sidebar-version="2026-01-31.99" data-sidebar-build="adminfix-2026-01-31"'
		);

		// NOTE: Do not inject/override ensureAdminAccess here.
		// The sidebar bundle and frontend/script.js already provide the correct logic.

		res.type('html');
		return res.status(200).send(html);
	} catch (e) {
		// Fallback: serve file as-is.
		return res.sendFile(path.join(FRONTEND_DIR, 'components', 'sidebar.html'));
	}
});

// Admin guard (used for API routes and some legacy aliases)
const requireAdmin = require('./middleware/requireAdmin');
// NOTE: Admin APIs remain protected under /api/admin/*.
// We serve admin HTML pages without backend gating so navigation does not depend on httpOnly cookies.
// The pages themselves will gate UI by probing admin-only endpoints.
app.get('/pages/admin/', (req, res) => res.redirect('/pages/admin/administracao.html'));
app.use('/pages/admin', express.static(path.join(FRONTEND_DIR, 'pages', 'admin'), {
	etag: false,
	lastModified: false,
	setHeaders: (res, filePath, stat) => {
		setNoCacheHeaders(res);
		try {
			res.setHeader('X-SimuladosBR-Static-File', path.basename(String(filePath || '')));
			res.setHeader('X-SimuladosBR-Static-Mtime', stat && stat.mtime ? stat.mtime.toISOString() : '');
		} catch(_){ }
	}
}));

// Friendly aliases for admin pages (HTML), protected
app.get('/admin/questions/form', requireAdmin, (req, res) => {
	setNoCacheHeaders(res);
	res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin', 'questionForm.html'));
});
app.get('/admin/questions/bulk', requireAdmin, (req, res) => {
	setNoCacheHeaders(res);
	res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin', 'questionBulk.html'));
});
// Serve dist only in production by default.
// In dev/debug, serving dist first can mask changes in frontend/ and create "stale script" surprises.
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const SERVE_DIST = (process.env.SERVE_DIST != null)
	? (String(process.env.SERVE_DIST).trim().toLowerCase() === 'true')
	: (NODE_ENV === 'production');

if (fs.existsSync(FRONTEND_DIST) && SERVE_DIST) {
	app.use(express.static(FRONTEND_DIST, {
		etag: false,
		lastModified: false,
		setHeaders: (res, filePath, stat) => {
			setNoCacheHeaders(res);
			try {
				res.setHeader('X-SimuladosBR-Static-File', path.basename(String(filePath || '')));
				res.setHeader('X-SimuladosBR-Static-Mtime', stat && stat.mtime ? stat.mtime.toISOString() : '');
			} catch(_){ }
		}
	}));
}

// If a navigation request arrives with ?sessionToken=..., convert it to the httpOnly cookie
// and redirect to a clean URL (prevents token leakage + avoids broken flows after cache clears).
app.use((req, res, next) => {
	try {
		if (req.method !== 'GET') return next();
		if (req.path.startsWith('/api/')) return next();
		const raw = (req.query && req.query.sessionToken) ? String(req.query.sessionToken).trim() : '';
		if (!raw) return next();

		const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
		// Legacy/insecure token transport via query is disabled in production by default.
		const allowInsecureTransports = !isProd || String(process.env.ALLOW_INSECURE_TOKEN_TRANSPORT || '').toLowerCase() === 'true';

		// Build clean URL without the sessionToken parameter
		let cleanPath = req.path;
		let cleanSearch = '';
		try {
			const u = new URL(req.originalUrl, `${req.protocol || 'http'}://${req.get('host')}`);
			u.searchParams.delete('sessionToken');
			cleanPath = u.pathname;
			cleanSearch = u.search || '';
		} catch (_) {
			// Fallback: remove sessionToken=... from query string best-effort
			try {
				const qs = String(req.originalUrl || '').split('?')[1] || '';
				if (qs) {
					const params = new URLSearchParams(qs);
					params.delete('sessionToken');
					const s = params.toString();
					cleanSearch = s ? ('?' + s) : '';
				}
			} catch (_e) {}
		}

		const looksJwt = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(raw);
		if (allowInsecureTransports && looksJwt) {
			const cookieOptions = {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'strict',
				maxAge: 12 * 60 * 60 * 1000,
				path: '/',
				domain: getCookieDomainForRequest(req),
			};
			try { res.cookie('sessionToken', raw, cookieOptions); } catch (_) {}
			// Backward-compat cleanup: older builds attempted Domain=.localhost.
			try {
				const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
				if (!isProd) {
					const hostRaw = String(req.get('host') || '').replace(/:\d+$/, '').toLowerCase();
					if (hostRaw === 'localhost' || hostRaw.endsWith('.localhost')) {
						res.clearCookie('sessionToken', { domain: '.localhost', path: '/' });
					}
				}
			} catch (_) {}
		}

		const target = cleanPath + cleanSearch;
		// Avoid redirect loops if for any reason the URL couldn't be cleaned.
		if (target && target !== req.originalUrl) {
			return res.redirect(302, target);
		}
		return next();
	} catch (e) {
		return next();
	}
});

// Enforce authentication for non-API navigation: redirect unauthenticated users to /login
app.use((req, res, next) => {
	try {
		if (req.method !== 'GET') return next();
		if (req.path.startsWith('/api/')) return next();
		// Allow chat-service proxy routes (widget/assets/API) without redirecting to /login
		if (req.path.startsWith('/chat/')) return next();
		// Product home on localhost:3000 is public
		if (isLocalhostHost(req)) return next();
		// Allow login and static asset files without auth
		const allowPaths = new Set([
			'/login',
			'/login.html',
			'/manifest.json',
		]);
		const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|json|webmanifest|map)$/i.test(req.path);
		if (allowPaths.has(req.path) || isAsset) return next();
		const hasCookie = !!(req.cookies && (req.cookies.sessionToken || req.cookies.jwtToken));
		const hasAuth = !!(req.headers && req.headers.authorization);
		if (!hasCookie && !hasAuth) {
			return res.redirect('/login');
		}
		return next();
	} catch (e) { return next(); }
});
app.use(express.static(FRONTEND_DIR, {
	etag: false,
	lastModified: false,
	setHeaders: (res, filePath, stat) => {
		setNoCacheHeaders(res);
		try {
			res.setHeader('X-SimuladosBR-Static-File', path.basename(String(filePath || '')));
			res.setHeader('X-SimuladosBR-Static-Mtime', stat && stat.mtime ? stat.mtime.toISOString() : '');
		} catch(_){ }
	}
}));

// Chat-service reverse proxy (widget + API). Must be before SPA fallback.
app.use('/chat', require('./routes/chatProxy'));

// Rota raiz: sirva a home (index.html); o script.js redireciona usuários logados para /pages/examSetup.html
app.get('/', (req, res) => {
	setNoCacheHeaders(res);
	return res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});
// Rota de login: serve a página dedicada de login
app.get('/login', (req, res) => {
	setNoCacheHeaders(res);
	return res.sendFile(path.join(FRONTEND_DIR, 'login.html'));
});

// Internal (server-to-server) endpoints (no CSRF; protected by x-access-api-key)
app.use('/internal/v1', require('./routes/internal_premium'));

// CSRF token endpoint (versioned and legacy)
app.get(`${API_V1}/csrf-token`, (req, res) => {
  const token = req.csrfToken();
  res.json({ csrfToken: token });
});
app.get(`${API_BASE}/csrf-token`, (req, res) => {
	const token = req.csrfToken();
	res.json({ csrfToken: token });
});

// CSRF protection for state-changing methods (versioned and legacy)
app.use(`${API_V1}/`, (req, res, next) => {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
		return next();
	}
	csrfProtection(req, res, next);
});
app.use(`${API_BASE}/`, (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  csrfProtection(req, res, next);
});

// Monta rotas de API (colocar antes da rota catch-all)
// Versioned (v1) routes
app.use(`${API_V1}/users`, require('./routes/users'));
app.use(`${API_V1}/auth`, require('./routes/auth'));
app.use(`${API_V1}/exams`, require('./routes/exams'));
app.use(`${API_V1}/admin/exams`, require('./routes/exams_admin'));
app.use(`${API_V1}/questions`, require('./routes/questions'));
app.use(`${API_V1}/meta`, require('./routes/meta'));
app.use(`${API_V1}/integrity`, require('./routes/integrity'));
app.use(`${API_V1}/indicators`, require('./routes/indicators'));
app.use(`${API_V1}/feedback`, require('./routes/feedback'));
app.use(`${API_V1}/admin/feedback`, require('./routes/admin_feedback'));
app.use(`${API_V1}/admin/notifications`, require('./routes/admin_notifications'));
app.use(`${API_V1}/admin/users`, require('./routes/admin_users'));
app.use(`${API_V1}/admin/communication`, require('./routes/admin_communication'));
app.use(`${API_V1}/admin/db`, require('./routes/admin_db'));
app.use(`${API_V1}/admin/data-explorer`, require('./routes/admin_data_explorer'));
app.use(`${API_V1}/admin/flashcards`, require('./routes/admin_flashcards'));
app.use(`${API_V1}/admin/dicas`, require('./routes/admin_dicas'));
app.use(`${API_V1}/admin/product-plans`, require('./routes/admin_product_plans'));
app.use(`${API_V1}/admin/user-params`, require('./routes/admin_user_params'));
app.use(`${API_V1}/dicas`, require('./routes/dicas'));
app.use(`${API_V1}/notifications`, require('./routes/notifications'));
app.use(`${API_V1}/debug`, require('./routes/debug'));
app.use(`${API_V1}/ai`, require('./routes/ai'));
app.use(`${API_V1}/flashcards`, require('./routes/flashcards'));

// Legacy (unversioned) routes kept for backward compatibility (deprecated)
app.use(`${API_BASE}/users`, require('./routes/users'));
app.use(`${API_BASE}/auth`, require('./routes/auth'));
app.use(`${API_BASE}/exams`, require('./routes/exams'));
app.use(`${API_BASE}/admin/exams`, require('./routes/exams_admin'));
app.use(`${API_BASE}/questions`, require('./routes/questions'));
app.use(`${API_BASE}/meta`, require('./routes/meta'));
app.use(`${API_BASE}/integrity`, require('./routes/integrity'));
app.use(`${API_BASE}/indicators`, require('./routes/indicators'));
app.use(`${API_BASE}/feedback`, require('./routes/feedback'));
app.use(`${API_BASE}/admin/feedback`, require('./routes/admin_feedback'));
app.use(`${API_BASE}/admin/notifications`, require('./routes/admin_notifications'));
app.use(`${API_BASE}/admin/users`, require('./routes/admin_users'));
app.use(`${API_BASE}/admin/communication`, require('./routes/admin_communication'));
app.use(`${API_BASE}/admin/db`, require('./routes/admin_db'));
app.use(`${API_BASE}/admin/product-plans`, require('./routes/admin_product_plans'));
app.use(`${API_BASE}/admin/user-params`, require('./routes/admin_user_params'));
app.use(`${API_BASE}/admin/data-explorer`, require('./routes/admin_data_explorer'));
app.use(`${API_BASE}/admin/flashcards`, require('./routes/admin_flashcards'));
app.use(`${API_BASE}/admin/dicas`, require('./routes/admin_dicas'));
app.use(`${API_BASE}/dicas`, require('./routes/dicas'));
app.use(`${API_BASE}/notifications`, require('./routes/notifications'));
app.use(`${API_BASE}/debug`, require('./routes/debug'));
app.use(`${API_BASE}/ai`, require('./routes/ai'));
app.use(`${API_BASE}/flashcards`, require('./routes/flashcards'));

// Para rotas não-API, devolve index.html (SPA fallback)
// NOTE: avoid using app.get('*') which can trigger path-to-regexp errors in some setups.
app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
		if (req.path.startsWith('/chat/')) return next();
		// Do not serve simulator SPA fallback on localhost (product site owns localhost).
		if (isLocalhostHost(req)) return next();
	// Only serve index.html for GET navigation requests
	if (req.method !== 'GET') return next();
			// Use o index.html da pasta frontend (não copiamos HTMLs para dist)
			setNoCacheHeaders(res);
			res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// API 404 handler (after all API routes)
app.use(['/api', '/api/v1'], (req, res, next) => {
  // If reached here, no API route matched
  next(new AppError('Endpoint não encontrado', 404, 'NOT_FOUND'));
});

// Error logging middleware (must be after all routes)
app.use(errorLogger);

// Centralized error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Chat-service admin realtime (WebSocket) in embedded mode.
// Standalone chat-service uses ws://<host>:4010/v1/admin/ws; embedded uses the same path on :3000.
if (CHAT_SERVICE_EMBED) {
	try {
		const { attachAdminWebSocketServer } = require('../chat-service/src/realtime/adminWs');
		chatEmbeddedWs = attachAdminWebSocketServer(server);
		logger.info('Chat-service WebSocket attached (embedded)');
	} catch (e) {
		logger.warn('Chat-service WebSocket attach failed (embedded)', { error: e && e.message ? String(e.message) : 'unknown' });
		chatEmbeddedWs = null;
	}
}

// WebSocket proxy for chat-service admin panel realtime.
// Browser connects to ws(s)://<host>/chat/v1/admin/ws, and we forward to chat-service /v1/admin/ws.
server.on('upgrade', async (req, socket, head) => {
	try {
		const url = String(req.url || '');
		if (!url.startsWith('/chat/v1/admin/ws')) return;
		// In embedded mode, chat-service WS is attached to this server and can accept
		// /chat/v1/admin/ws directly. Avoid double-handling the same socket.
		if (CHAT_SERVICE_EMBED) return;

		const target = getChatServiceBaseUrl();
		if (!target) {
			try { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); } catch {}
			try { socket.destroy(); } catch {}
			return;
		}

		// Attach helpers expected by requireAdmin.
		req.get = (name) => {
			const key = String(name || '').toLowerCase();
			return (req.headers && req.headers[key]) ? String(req.headers[key]) : undefined;
		};
		// Parse cookies (requireAdmin reads req.cookies.sessionToken).
		await new Promise((resolve) => cookieParser()(req, {}, resolve));
		// Parse query params (requireAdmin accepts sessionToken from query as fallback).
		try {
			const u = new URL(url, 'http://localhost');
			req.query = Object.fromEntries(u.searchParams.entries());
		} catch {
			req.query = {};
		}

		// Enforce admin role (same behavior as HTTP /chat/v1/admin/*).
		const requireAdminWs = require('./middleware/requireAdmin');
		let allowed = false;
		await new Promise((resolve) => {
			const res = {
				redirect() {
					allowed = false;
					resolve();
				},
				status(code) {
					this.statusCode = code;
					return this;
				},
				json() {
					allowed = false;
					resolve();
				},
			};
			requireAdminWs(req, res, () => {
				allowed = true;
				resolve();
			});
		});
		if (!allowed) {
			try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch {}
			try { socket.destroy(); } catch {}
			return;
		}

		// Rewrite path: /chat/v1/admin/ws -> /v1/admin/ws (upstream).
		req.url = url.replace(/^\/chat/, '');
		// Do not leak SimuladosBR auth token to upstream.
		try {
			const u2 = new URL(req.url, 'http://localhost');
			u2.searchParams.delete('sessionToken');
			req.url = u2.pathname + u2.search;
		} catch {}
		// Avoid upstream origin enforcement when called via same-origin reverse proxy.
		try { delete req.headers.origin; } catch {}
		try { delete req.headers.referer; } catch {}
		try { delete req.headers.cookie; } catch {}
		try { delete req.headers['x-session-token']; } catch {}
		chatWsProxy.ws(req, socket, head, { target });
	} catch {
		try { socket.destroy(); } catch {}
	}
});

server.listen(PORT, () => {
	logger.info(`Server started successfully`, {
		port: PORT,
		environment: process.env.NODE_ENV || 'development',
		node_version: process.version
	});
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
	logger.info('SIGTERM signal received: closing HTTP server');
	server.close(() => {
		logger.info('HTTP server closed');
		sequelize.close().then(() => {
			logger.info('Database connection closed');
			process.exit(0);
		});
	});
});

process.on('SIGINT', () => {
	logger.info('SIGINT signal received: closing HTTP server');
	process.exit(0);
});

// If enabled, serve the chat-service app by hostname (ex.: http://chat.localhost:3000).
// Important: do NOT call next() into the main app when chat host matches, to avoid
// auth redirects / SPA fallbacks taking over.
app.use((req, res, next) => {
	try {
		if (!CHAT_SERVICE_EMBED) return next();
		if (!isChatHost(req)) return next();
		if (!chatEmbeddedApp) return res.status(503).send('chat-service unavailable');
		return chatEmbeddedApp(req, res);
	} catch (_) {
		return res.status(500).send('chat-service error');
	}
});