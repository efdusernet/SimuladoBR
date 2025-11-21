const express = require('express');
const router = express.Router();
const db = require('../models');
const { User, EmailVerification } = db;
// User daily exam attempt stats service
const userStatsService = require('../services/UserStatsService')(db);
const crypto = require('crypto');
const { generateVerificationCode } = require('../utils/codegen');
const { sendVerificationEmail } = require('../utils/mailer');
const bcrypt = require('bcryptjs');

/**
 * POST /api/users
 * Cria usuário persistido no banco (tabela Usuario)
 */
router.post('/', async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.Nome || typeof body.Nome !== 'string' || !body.Nome.trim()) {
            return res.status(400).json({ message: 'Nome obrigatório' });
        }

        if (!body.Email || typeof body.Email !== 'string') {
            return res.status(400).json({ message: 'Email obrigatório' });
        }

        const email = body.Email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: 'Email inválido' });
        }

        // verifica duplicidade
        const existing = await User.findOne({ where: { Email: email } });
        if (existing) {
            return res.status(409).json({ message: 'Usuário com este e-mail já existe' });
        }

        const sessionToken = (req.get('X-Session-Token') || '').trim();
        const nomeUsuario = sessionToken ? sessionToken : (body.NomeUsuario || email);

        // If a SenhaHash (client-side SHA256 hex) is provided, bcrypt it before storing.
        let senhaHashToStore = null;
        if (body.SenhaHash && typeof body.SenhaHash === 'string') {
            // use 10 salt rounds
            senhaHashToStore = await bcrypt.hash(body.SenhaHash, 10);
        }

        const createObj = {
            AccessFailedCount: body.AccessFailedCount ?? 0,
            Email: email,
            EmailConfirmado: body.EmailConfirmado ?? false,
            BloqueioAtivado: body.BloqueioAtivado ?? true,
            FimBloqueio: body.FimBloqueio ?? null,
            NomeUsuario: nomeUsuario,
            SenhaHash: senhaHashToStore,
            NumeroTelefone: body.NumeroTelefone ?? null,
            Nome: body.Nome ?? null,
            ForcarLogin: body.ForcarLogin ?? null,
            DataCadastro: body.DataCadastro ? new Date(body.DataCadastro) : new Date(),
            DataAlteracao: body.DataAlteracao ? new Date(body.DataAlteracao) : new Date(),
            Excluido: body.Excluido ?? null
        };

        const created = await User.create(createObj);

        // Create email verification token (expires in 24h)
        try {
            // 6-character alphanumeric verification code
            const token = generateVerificationCode(6);
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await EmailVerification.create({ UserId: created.Id, Token: token, ExpiresAt: expiresAt, Used: false, CreatedAt: new Date() });
            // send email (if configured); in dev this may log the token
            await sendVerificationEmail(created.Email, token);
        } catch (mailErr) {
            console.error('Erro criando/enviando token de verificação:', mailErr);
        }

        // Return the DB fields in the final format the frontend expects.
        // Convert dates to ISO strings for consistency.
        return res.status(201).json({
            Id: created.Id,
            NomeUsuario: created.NomeUsuario,
            Email: created.Email,
            EmailConfirmado: created.EmailConfirmado,
            BloqueioAtivado: created.BloqueioAtivado,
            DataCadastro: created.DataCadastro ? new Date(created.DataCadastro).toISOString() : null,
            DataAlteracao: created.DataAlteracao ? new Date(created.DataAlteracao).toISOString() : null,
            Excluido: created.Excluido ?? null
        });
    } catch (err) {
        console.error('Erro criando usuário (DB):', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

// GET /api/users
// Dev-only: lista usuários (omitindo SenhaHash). Desabilitado em produção.
router.get('/', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ message: 'Forbidden in production' });
        }

        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;

        const users = await User.findAll({
            attributes: { exclude: ['SenhaHash'] },
            limit,
            offset,
            order: [['Id', 'DESC']]
        });

        return res.json(users);
    } catch (err) {
        console.error('Erro listando usuários (dev):', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

module.exports = router;
/**
 * GET /api/users/me/stats/daily?days=30
 * Retorna série diária de métricas de tentativas (started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent).
 * Requer header X-Session-Token (id numérico ou NomeUsuario/Email).
 */
router.get('/me/stats/daily', async (req, res) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        let user = null;
        if (/^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });
        let days = Number(req.query.days) || 30;
        if (!Number.isFinite(days) || days <= 0) days = 30;
        days = Math.min(Math.max(days, 1), 180); // clamp 1..180
        const rows = await userStatsService.getDailyStats(user.Id || user.id, days);
        return res.json({ days, data: rows });
    } catch (err) {
        console.error('Erro user daily stats:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * GET /api/users/me/stats/summary?days=30
 * Retorna resumo agregado do período (totais e rates).
 */
router.get('/me/stats/summary', async (req, res) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        let user = null;
        if (/^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });
        let days = Number(req.query.days) || 30;
        if (!Number.isFinite(days) || days <= 0) days = 30;
        days = Math.min(Math.max(days, 1), 180);
        const summary = await userStatsService.getSummary(user.Id || user.id, days);
        return res.json(summary);
    } catch (err) {
        console.error('Erro user stats summary:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});