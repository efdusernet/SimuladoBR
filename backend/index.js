const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize structured logging system
const { logger } = require('./utils/logger');
const { requestLogger, errorLogger } = require('./middleware/logging');
const { AppError, errorHandler } = require('./middleware/errorHandler');

// Validate security configuration early (will exit if JWT_SECRET invalid)
require('./config/security');

const app = express();

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
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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
const path = require('path');
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const fs = require('fs');

// Protect admin pages before static middleware: only admins can fetch /pages/admin/* HTML files
const requireAdmin = require('./middleware/requireAdmin');
// Redirect /pages/admin/ to login
app.get('/pages/admin/', (req, res) => res.redirect('/login'));
app.use('/pages/admin', requireAdmin, express.static(path.join(FRONTEND_DIR, 'pages', 'admin')));

// Friendly aliases for admin pages (HTML), protected
app.get('/admin/questions/form', requireAdmin, (req, res) => {
	res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin', 'questionForm.html'));
});
app.get('/admin/questions/bulk', requireAdmin, (req, res) => {
	res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin', 'questionBulk.html'));
});
if (fs.existsSync(FRONTEND_DIST)) {
	app.use(express.static(FRONTEND_DIST));
}
// Enforce authentication for non-API navigation: redirect unauthenticated users to /login
app.use((req, res, next) => {
	try {
		if (req.method !== 'GET') return next();
		if (req.path.startsWith('/api/')) return next();
		// Allow login and static asset files without auth
		const allowPaths = new Set(['/login', '/login.html', '/manifest.json']);
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
app.use(express.static(FRONTEND_DIR));

// Rota raiz: sirva a home (index.html); o script.js redireciona usuários logados para /pages/examSetup.html
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
// Rota de login: serve a página dedicada de login
app.get('/login', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));

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
app.use(`${API_V1}/notifications`, require('./routes/notifications'));
app.use(`${API_V1}/debug`, require('./routes/debug'));

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
app.use(`${API_BASE}/notifications`, require('./routes/notifications'));
app.use(`${API_BASE}/debug`, require('./routes/debug'));

// Para rotas não-API, devolve index.html (SPA fallback)
// NOTE: avoid using app.get('*') which can trigger path-to-regexp errors in some setups.
app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
	// Only serve index.html for GET navigation requests
	if (req.method !== 'GET') return next();
			// Use o index.html da pasta frontend (não copiamos HTMLs para dist)
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
app.listen(PORT, () => {
	logger.info(`Server started successfully`, {
		port: PORT,
		environment: process.env.NODE_ENV || 'development',
		node_version: process.version
	});
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
	logger.info('SIGTERM signal received: closing HTTP server');
	app.close(() => {
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