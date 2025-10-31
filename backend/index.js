const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
// Security headers (CSP disabled initially to avoid breaking inline assets; can be tightened later)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());

// Conexão com DB e modelos
const db = require('./models');
const sequelize = db.sequelize;

sequelize.authenticate().then(() => console.log('DB conectado!')).catch(err => console.error('Erro:', err));

// Opcional: sincroniza modelos com o banco quando DB_SYNC=true
if (process.env.DB_SYNC === 'true') {
	sequelize.sync({ alter: true })
		.then(() => console.log('Modelos sincronizados com o DB (alter).'))
		.catch(err => console.error('Erro ao sincronizar modelos:', err));
}

// Rotas
// Basic API rate limiting
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// Serve frontend estático (prioriza dist se existir)
const path = require('path');
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(require('fs').existsSync(FRONTEND_DIST) ? FRONTEND_DIST : FRONTEND_DIR));

// Rota raiz: sirva a home (index.html); o script.js redireciona usuários logados para /pages/examSetup.html
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// Monta rotas de API (colocar antes da rota catch-all)
app.use('/api/users', require('./routes/users'));
// Auth routes (login)
app.use('/api/auth', require('./routes/auth'));
// Exams (select questions)
app.use('/api/exams', require('./routes/exams'));
// Meta lists for exam setup
app.use('/api/meta', require('./routes/meta'));
// Play Integrity
app.use('/api/integrity', require('./routes/integrity'));
// Mount debug routes (development only)
app.use('/api/debug', require('./routes/debug'));

// Para rotas não-API, devolve index.html (SPA fallback)
// NOTE: avoid using app.get('*') which can trigger path-to-regexp errors in some setups.
app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
	// Only serve index.html for GET navigation requests
	if (req.method !== 'GET') return next();
		const baseDir = require('fs').existsSync(FRONTEND_DIST) ? FRONTEND_DIST : FRONTEND_DIR;
		res.sendFile(path.join(baseDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));