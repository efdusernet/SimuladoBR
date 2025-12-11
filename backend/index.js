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

// Validate security configuration early (will exit if JWT_SECRET invalid)
require('./config/security');

const app = express();

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
// Basic API rate limiting
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

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
app.use(express.static(FRONTEND_DIR));

// Rota raiz: sirva a home (index.html); o script.js redireciona usuários logados para /pages/examSetup.html
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
// Rota de login: serve a página dedicada de login
app.get('/login', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));

// CSRF token endpoint
app.get('/api/csrf-token', (req, res) => {
  const token = req.csrfToken();
  res.json({ csrfToken: token });
});

// CSRF protection for state-changing methods
app.use('/api/', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  csrfProtection(req, res, next);
});

// Monta rotas de API (colocar antes da rota catch-all)
app.use('/api/users', require('./routes/users'));
// Auth routes (login)
app.use('/api/auth', require('./routes/auth'));
// Exams (select questions)
app.use('/api/exams', require('./routes/exams'));
// Exams admin lifecycle endpoints
app.use('/api/admin/exams', require('./routes/exams_admin'));
// Questions (admin)
app.use('/api/questions', require('./routes/questions'));
// Meta lists for exam setup
app.use('/api/meta', require('./routes/meta'));
// Play Integrity
app.use('/api/integrity', require('./routes/integrity'));
// Indicators API
app.use('/api/indicators', require('./routes/indicators'));
// Feedback reporting
app.use('/api/feedback', require('./routes/feedback'));
// Admin feedback responses
app.use('/api/admin/feedback', require('./routes/admin_feedback'));
// Admin notifications
app.use('/api/admin/notifications', require('./routes/admin_notifications'));
// Admin users (list for selection)
app.use('/api/admin/users', require('./routes/admin_users'));
// User notifications
app.use('/api/notifications', require('./routes/notifications'));
// Admin: roles management (removed)
// Mount debug routes (development only)
app.use('/api/debug', require('./routes/debug'));

// Para rotas não-API, devolve index.html (SPA fallback)
// NOTE: avoid using app.get('*') which can trigger path-to-regexp errors in some setups.
app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
	// Only serve index.html for GET navigation requests
	if (req.method !== 'GET') return next();
			// Use o index.html da pasta frontend (não copiamos HTMLs para dist)
			res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Error logging middleware (must be after all routes)
app.use(errorLogger);

// Global error handler
app.use((err, req, res, next) => {
	const statusCode = err.statusCode || 500;
	const message = err.message || 'Internal server error';
	
	res.status(statusCode).json({
		success: false,
		message,
		...(process.env.NODE_ENV === 'development' && { stack: err.stack })
	});
});

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