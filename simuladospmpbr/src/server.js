import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

import { config } from './shared/config.js';
import { pagesRouter } from './web/pages.router.js';
import { healthRouter } from './web/health.router.js';
import { webhooksRouter } from './web/webhooks.router.js';
import { debugRouter } from './web/debug.router.js';
import { apiRouter } from './web/api.router.js';
import { financeAdminRouter } from './web/financeAdmin.router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use('/public', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.nodeEnv === 'production' ? '7d' : 0
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// Inject globals into views
app.use((req, res, next) => {
  res.locals.productName = config.productName;
  res.locals.baseUrl = config.baseUrl;
  res.locals.supportEmail = config.supportEmail;
  next();
});

app.use(healthRouter);
app.use(apiRouter);
app.use(debugRouter);
app.use(webhooksRouter);
app.use(financeAdminRouter);
app.use(pagesRouter);

app.use((req, res) => {
  res.status(404).render('pages/404', { title: 'Página não encontrada' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err?.status || 500;
  const requestId = req.headers['x-request-id'] ?? null;

  if (config.nodeEnv !== 'production') {
    // Helpful during dev
    // eslint-disable-next-line no-console
    console.error(err);
  }

  if (req.accepts('html')) {
    return res.status(status).render('pages/error', {
      title: 'Erro',
      status,
      message: status === 403 ? 'Requisição inválida (CSRF).' : 'Ocorreu um erro inesperado.',
      requestId
    });
  }

  return res.status(status).json({
    error: status === 403 ? 'csrf' : 'internal',
    requestId
  });
});

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[site] listening on http://localhost:${config.port}`);
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`[site] Port ${config.port} already in use. Set PORT in .env (e.g. PORT=3000) and try again.`);
    process.exit(1);
  }
});
