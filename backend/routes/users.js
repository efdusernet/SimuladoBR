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

// GET /api/users/me
// Retorna dados básicos do usuário autenticado (deduzido pelo X-Session-Token ou query sessionToken)
// Inclui flag TipoUsuario derivada (admin|user) baseada em lista de e-mails configurada ou nome de usuário.
router.get('/me', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        let user = null;
        // If token looks like JWT, try to decode
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                // Try by sub (user id) first
                if (decoded && decoded.sub) {
                    user = await User.findByPk(Number(decoded.sub));
                }
                // Fallback: try by email
                if (!user && decoded && decoded.email) {
                    user = await User.findOne({ where: { Email: decoded.email } });
                }
            } catch (e) {
                // Invalid JWT, fallback to legacy lookup
            }
        }
        // Legacy: if numeric, try by Id first
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        // Legacy: try by username or email
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });
        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        const emailLower = String(user.Email || '').toLowerCase();
        const nomeLower = String(user.NomeUsuario || '').toLowerCase();
        const isAdmin = adminEmails.includes(emailLower) || nomeLower === 'admin' || nomeLower.startsWith('admin_');
        return res.json({
            Id: user.Id,
            NomeUsuario: user.NomeUsuario,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado,
            DataCadastro: user.DataCadastro ? new Date(user.DataCadastro).toISOString() : null,
            DataAlteracao: user.DataAlteracao ? new Date(user.DataAlteracao).toISOString() : null,
            TipoUsuario: isAdmin ? 'admin' : 'user'
        });
    } catch (err) {
        console.error('Erro /users/me:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * GET /api/users/me/stats/daily?days=30
 * Retorna série diária de métricas de tentativas (started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent).
 * Requer header X-Session-Token (id numérico ou NomeUsuario/Email).
 */
router.get('/me/stats/daily', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
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
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
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

/**
 * PUT /api/users/me/profile
 * Atualiza Nome e NomeUsuario do usuário autenticado
 */
router.put('/me/profile', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { Nome, NomeUsuario } = req.body || {};
        
        if (!Nome || !Nome.trim()) {
            return res.status(400).json({ message: 'Nome é obrigatório' });
        }

        // Update fields
        user.Nome = Nome.trim();
        if (NomeUsuario && NomeUsuario.trim()) {
            user.NomeUsuario = NomeUsuario.trim();
        }
        user.DataAlteracao = new Date();
        
        await user.save();
        
        return res.json({ message: 'Perfil atualizado com sucesso', user: { Id: user.Id, Nome: user.Nome, NomeUsuario: user.NomeUsuario } });
    } catch (err) {
        console.error('Erro ao atualizar perfil:', err);
        return res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * POST /api/users/me/email/request-change
 * Solicita alteração de email e envia código de verificação
 */
router.post('/me/email/request-change', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { newEmail } = req.body || {};
        
        if (!newEmail || !newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
            return res.status(400).json({ message: 'Email inválido' });
        }

        const emailLower = newEmail.trim().toLowerCase();
        
        // CRITICAL: Check if email already exists in database (prevent takeover)
        // Use case-insensitive search with ILIKE for PostgreSQL
        const Op = db.Sequelize && db.Sequelize.Op;
        const whereClause = Op ? { Email: { [Op.iLike]: emailLower } } : { Email: emailLower };
        const existing = await User.findOne({ where: whereClause });
        if (existing) {
            // Even if it's the same user, reject to prevent confusion
            const existingId = Number(existing.Id || existing.id);
            const currentUserId = Number(user.Id || user.id);
            if (existingId !== currentUserId) {
                console.warn(`[SECURITY] User ${currentUserId} attempted to change email to already registered email: ${emailLower} (owner: ${existingId})`);
                return res.status(409).json({ message: 'Este email já está em uso' });
            }
            // If same user, they already have this email - no change needed
            return res.status(400).json({ message: 'Este já é o seu email atual' });
        }

        // Create verification token
        const token = generateVerificationCode(6);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
        
        // Store with metadata indicating it's for email change
        await EmailVerification.create({ 
            UserId: user.Id, 
            Token: token, 
            ExpiresAt: expiresAt, 
            Used: false, 
            CreatedAt: new Date(),
            Meta: JSON.stringify({ type: 'email_change', newEmail: emailLower })
        });
        
        // Send verification email to new address
        await sendVerificationEmail(emailLower, token);
        
        return res.json({ message: 'Código de verificação enviado para o novo email' });
    } catch (err) {
        console.error('Erro ao solicitar alteração de email:', err);
        return res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * POST /api/users/me/email/verify-change
 * Verifica código e efetua alteração de email
 */
router.post('/me/email/verify-change', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { newEmail, token } = req.body || {};
        
        if (!token || !token.trim()) {
            return res.status(400).json({ message: 'Código de verificação obrigatório' });
        }

        // Find verification record
        const verification = await EmailVerification.findOne({
            where: {
                UserId: user.Id,
                Token: token.trim(),
                Used: false
            },
            order: [['CreatedAt', 'DESC']]
        });

        if (!verification) {
            return res.status(400).json({ message: 'Código inválido ou já utilizado' });
        }

        if (new Date() > new Date(verification.ExpiresAt)) {
            return res.status(400).json({ message: 'Código expirado' });
        }

        // Verify metadata matches
        let meta = {};
        try {
            meta = JSON.parse(verification.Meta || '{}');
        } catch(_) { }

        if (meta.type !== 'email_change' || meta.newEmail !== newEmail.trim().toLowerCase()) {
            return res.status(400).json({ message: 'Código não corresponde à solicitação' });
        }

        // Update email and mark as confirmed
        user.Email = newEmail.trim().toLowerCase();
        user.EmailConfirmado = true;
        user.DataAlteracao = new Date();
        await user.save();

        // Mark token as used
        verification.Used = true;
        await verification.save();

        return res.json({ message: 'Email alterado com sucesso' });
    } catch (err) {
        console.error('Erro ao verificar alteração de email:', err);
        return res.status(500).json({ error: 'Erro interno' });
    }
});

/**
 * PUT /api/users/me/password
 * Altera senha do usuário autenticado
 */
router.put('/me/password', async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });
        
        let user = null;
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                if (decoded && decoded.sub) user = await User.findByPk(Number(decoded.sub));
                if (!user && decoded && decoded.email) user = await User.findOne({ where: { Email: decoded.email } });
            } catch(_) { /* ignore */ }
        }
        if (!user && /^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
        if (!user) {
            const Op = db.Sequelize && db.Sequelize.Op;
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword, newPassword } = req.body || {};
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Nova senha deve ter no mínimo 6 caracteres' });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.SenhaHash);
        if (!isValid) {
            return res.status(401).json({ message: 'Senha atual incorreta' });
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPassword, 10);
        user.SenhaHash = newHash;
        user.DataAlteracao = new Date();
        await user.save();

        return res.json({ message: 'Senha alterada com sucesso' });
    } catch (err) {
        console.error('Erro ao alterar senha:', err);
        return res.status(500).json({ error: 'Erro interno' });
    }
});

module.exports = router;