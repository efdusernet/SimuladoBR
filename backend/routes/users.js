const express = require('express');
const { logger } = require('../utils/logger');
const { badRequest, unauthorized, forbidden, conflict, notFound, internalError } = require('../middleware/errors');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../models');
const { User, EmailVerification } = db;
const { extractTokenFromRequest, verifyJwtAndGetActiveUser } = require('../utils/singleSession');
// User daily exam attempt stats service
const userStatsService = require('../services/UserStatsService')(db);
const crypto = require('crypto');
const { generateVerificationCode } = require('../utils/codegen');
const { sendVerificationEmail } = require('../utils/mailer');
const bcrypt = require('bcryptjs');
const { authSchemas, userSchemas, validate } = require('../middleware/validation');

// Explicitly set bcrypt rounds for password hashing security
const BCRYPT_ROUNDS = 12;

// Rate limiter for user registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  message: 'Muitas tentativas de registro. Aguarde 1 hora.',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /api/users
 * Cria usuário persistido no banco (tabela Usuario)
 */
router.post('/', registerLimiter, validate(authSchemas.register), async (req, res, next) => {
    try {
        const body = req.body;

        const email = body.Email.trim().toLowerCase();

        // verifica duplicidade
        const existing = await User.findOne({ where: { Email: email } });
        if (existing) {
            return next(conflict('Usuário com este e-mail já existe', 'EMAIL_ALREADY_EXISTS'));
        }

        const sessionToken = (req.get('X-Session-Token') || '').trim();
        const nomeUsuario = sessionToken ? sessionToken : (body.NomeUsuario || email);

        // If a SenhaHash (client-side SHA256 hex) is provided, bcrypt it before storing.
        let senhaHashToStore = null;
        if (body.SenhaHash && typeof body.SenhaHash === 'string') {
            senhaHashToStore = await bcrypt.hash(body.SenhaHash, BCRYPT_ROUNDS);
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
            // Note: Este é um novo usuário, então não há tokens anteriores para invalidar
            // Mas por consistência, verificamos se há algum token não usado (caso de recriação)
            const existingTokens = await EmailVerification.findAll({
                where: {
                    UserId: created.Id,
                    Used: false
                }
            });

            for (const oldToken of existingTokens) {
                try {
                    const oldMeta = oldToken.Meta ? JSON.parse(oldToken.Meta) : {};
                    // Se não tem meta ou se é verificação de email inicial
                    if (!oldMeta.type || (oldMeta.type !== 'password_reset' && oldMeta.type !== 'email_change')) {
                        await oldToken.update({ ForcedExpiration: true });
                        logger.info(`[register] Token anterior ${oldToken.Token} forçadamente expirado para UserId ${created.Id}`);
                    }
                } catch (e) {
                    logger.warn('[register] Erro ao processar meta de token antigo:', e);
                }
            }

            // 6-character alphanumeric verification code
            const token = generateVerificationCode(6).toUpperCase();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await EmailVerification.create({ UserId: created.Id, Token: token, ExpiresAt: expiresAt, Used: false, CreatedAt: new Date() });
            
            // send email (if configured); in dev this may log the token
            await sendVerificationEmail(created.Email, token);
        } catch (mailErr) {
            logger.error('Erro criando/enviando token de verificação:', mailErr);
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
        logger.error('Erro criando usuário (DB):', err);
        return next(internalError('Erro interno', 'USER_CREATE_ERROR', err));
    }
});

// GET /api/users
// Dev-only: lista usuários (omitindo SenhaHash). Desabilitado em produção.
router.get('/', async (req, res, next) => {
    try {
        if (process.env.NODE_ENV === 'production') {
            return next(forbidden('Forbidden in production', 'FORBIDDEN_IN_PRODUCTION'));
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
        logger.error('Erro listando usuários (dev):', err);
        return next(internalError('Erro interno', 'USER_LIST_ERROR', err));
    }
});

// GET /api/users/me
// Retorna dados básicos do usuário autenticado (deduzido pelo cookie sessionToken, X-Session-Token header ou query sessionToken)
// Inclui flag TipoUsuario derivada (admin|user) baseada em lista de e-mails configurada ou nome de usuário.
router.get('/me', async (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);
        const authRes = await verifyJwtAndGetActiveUser(token);
        if (!authRes.ok) {
            if (authRes.status === 401) return next(unauthorized(authRes.message, authRes.code));
            if (authRes.status === 403) return next(forbidden(authRes.message, authRes.code));
            return next(unauthorized(authRes.message, authRes.code));
        }

        const user = authRes.user;

        // Admin resolution policy:
        // 1) Prefer RBAC role membership if tables exist (slug=admin)
        // 2) Fallback to configured ADMIN_EMAILS and legacy username conventions
        let isAdminByRole = false;
        try {
            const rows = await db.sequelize.query(
                'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
                { replacements: { uid: user.Id, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
            );
            isAdminByRole = !!(rows && rows.length);
        } catch (err) {
            // If RBAC tables are missing or query fails, ignore and fallback.
            // (Do not log as error to avoid noisy logs on deployments without RBAC.)
        }

        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        const emailLower = String(user.Email || '').toLowerCase();
        const nomeLower = String(user.NomeUsuario || '').toLowerCase();
        const isAdmin = isAdminByRole || adminEmails.includes(emailLower) || nomeLower === 'admin' || nomeLower.startsWith('admin_');
        return res.json({
            Id: user.Id,
            Nome: user.Nome,
            NomeUsuario: user.NomeUsuario,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado,
            DataCadastro: user.DataCadastro ? new Date(user.DataCadastro).toISOString() : null,
            DataAlteracao: user.DataAlteracao ? new Date(user.DataAlteracao).toISOString() : null,
            DataExame: user.DataExame ?? null,
            TipoUsuario: isAdmin ? 'admin' : 'user'
        });
    } catch (err) {
        logger.error('Erro /users/me:', err);
        return next(internalError('Internal error', 'USER_ME_ERROR', err));
    }
});

// PUT /api/users/me/exam-date
// Atualiza a data prevista do exame real do próprio usuário.
// Formato exigido: dd/mm/yyyy (armazenado em Usuario.data_exame).
router.put('/me/exam-date', async (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);
        const authRes = await verifyJwtAndGetActiveUser(token);
        if (!authRes.ok) {
            if (authRes.status === 401) return next(unauthorized(authRes.message, authRes.code));
            if (authRes.status === 403) return next(forbidden(authRes.message, authRes.code));
            return next(unauthorized(authRes.message, authRes.code));
        }

        const user = authRes.user;

        const raw = (req.body && (req.body.data_exame ?? req.body.DataExame ?? req.body.dataExame)) ?? null;
        const value = raw == null ? null : String(raw).trim();
        if (value && !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
            return next(badRequest('Formato inválido. Use dd/mm/yyyy', 'INVALID_EXAM_DATE_FORMAT'));
        }
        if (value) {
            const [dd, mm, yyyy] = value.split('/').map(v => parseInt(v, 10));
            const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
            const ok = dt.getUTCFullYear() === yyyy && (dt.getUTCMonth() + 1) === mm && dt.getUTCDate() === dd;
            if (!ok) {
                return next(badRequest('Data inválida', 'INVALID_EXAM_DATE_VALUE'));
            }

            // Não permitir datas no passado (comparação por data local do servidor)
            const inputYmd = (yyyy * 10000) + (mm * 100) + dd;
            const now = new Date();
            const todayYmd = (now.getFullYear() * 10000) + ((now.getMonth() + 1) * 100) + now.getDate();
            if (inputYmd < todayYmd) {
                return next(badRequest('Data não pode ser no passado', 'EXAM_DATE_IN_PAST'));
            }
        }

        await user.update({
            DataExame: value || null,
            DataAlteracao: new Date()
        });

        return res.json({
            success: true,
            DataExame: user.DataExame ?? null
        });
    } catch (err) {
        logger.error('Erro PUT /users/me/exam-date:', err);
        return next(internalError('Erro interno', 'USER_EXAM_DATE_UPDATE_ERROR', err));
    }
});

// GET /api/users/me/eco-version?examTypeSlug=pmp
// Returns the effective ECO version for the logged user (override -> current -> latest).
router.get('/me/eco-version', async (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);
        const authRes = await verifyJwtAndGetActiveUser(token);
        if (!authRes.ok) {
            if (authRes.status === 401) return next(unauthorized(authRes.message, authRes.code));
            if (authRes.status === 403) return next(forbidden(authRes.message, authRes.code));
            return next(unauthorized(authRes.message, authRes.code));
        }

        const user = authRes.user;

        const examTypeSlug = String(req.query.examTypeSlug || 'pmp').trim().toLowerCase();
        const examType = await db.ExamType.findOne({ where: { Slug: examTypeSlug } });
        if (!examType) return next(notFound('Exam type not found', 'EXAM_TYPE_NOT_FOUND', { examTypeSlug }));

        const examTypeId = Number(examType.Id);
        const userId = Number(user.Id);
        const sequelize = db.sequelize;
        let examContentVersionId = null;
        let source = null;

        // 1) Override per user
        try {
            const rows = await sequelize.query(
                `SELECT uecv.exam_content_version_id AS id
                   FROM user_exam_content_version uecv
                  WHERE uecv.user_id = :uid
                    AND uecv.exam_type_id = :examTypeId
                    AND uecv.active = TRUE
                    AND (uecv.starts_at IS NULL OR uecv.starts_at <= NOW())
                    AND (uecv.ends_at IS NULL OR uecv.ends_at > NOW())
                  ORDER BY uecv.id DESC
                  LIMIT 1`,
                { replacements: { uid: userId, examTypeId }, type: sequelize.QueryTypes.SELECT }
            );
            if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
                const n = Number(rows[0].id);
                if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'override'; }
            }
        } catch (_) { /* ignore */ }

        // 2) Current/default
        if (!examContentVersionId) {
            try {
                const rows = await sequelize.query(
                    `SELECT exam_content_version_id AS id
                       FROM exam_content_current_version
                      WHERE exam_type_id = :examTypeId
                      LIMIT 1`,
                    { replacements: { examTypeId }, type: sequelize.QueryTypes.SELECT }
                );
                if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
                    const n = Number(rows[0].id);
                    if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'current'; }
                }
            } catch (_) { /* ignore */ }
        }

        // 3) Latest
        if (!examContentVersionId) {
            try {
                const rows = await sequelize.query(
                    `SELECT id
                       FROM exam_content_version
                      WHERE exam_type_id = :examTypeId
                      ORDER BY effective_from DESC NULLS LAST, id DESC
                      LIMIT 1`,
                    { replacements: { examTypeId }, type: sequelize.QueryTypes.SELECT }
                );
                if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
                    const n = Number(rows[0].id);
                    if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'latest'; }
                }
            } catch (_) { /* ignore */ }
        }

        let version = null;
        if (examContentVersionId) {
            try {
                const rows = await sequelize.query(
                    `SELECT id, exam_type_id, code, effective_from, notes
                       FROM exam_content_version
                      WHERE id = :id
                      LIMIT 1`,
                    { replacements: { id: examContentVersionId }, type: sequelize.QueryTypes.SELECT }
                );
                if (Array.isArray(rows) && rows[0]) {
                    version = {
                        id: Number(rows[0].id),
                        examTypeId: Number(rows[0].exam_type_id),
                        code: rows[0].code || null,
                        effectiveFrom: rows[0].effective_from ? String(rows[0].effective_from) : null,
                        notes: rows[0].notes || null
                    };
                }
            } catch (_) { /* ignore */ }
        }

        return res.json({
            userId,
            examType: { id: examTypeId, slug: examTypeSlug, nome: examType.Nome || null },
            effective: {
                source,
                examContentVersionId: examContentVersionId || null,
                version
            }
        });
    } catch (err) {
        logger.error('Erro /users/me/eco-version:', err);
        return next(internalError('Internal error', 'USER_ME_ECO_VERSION_ERROR', err));
    }
});

/**
 * GET /api/users/me/stats/daily?days=30
 * Retorna série diária de métricas de tentativas (started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent).
 * Requer header X-Session-Token (id numérico ou NomeUsuario/Email).
 */
router.get('/me/stats/daily', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));
        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;
        let days = Number(req.query.days) || 30;
        if (!Number.isFinite(days) || days <= 0) days = 30;
        days = Math.min(Math.max(days, 1), 180); // clamp 1..180
        const rows = await userStatsService.getDailyStats(user.Id || user.id, days);
        return res.json({ days, data: rows });
    } catch (err) {
        logger.error('Erro user daily stats:', err);
        return next(internalError('Internal error', 'USER_DAILY_STATS_ERROR', err));
    }
});

/**
 * GET /api/users/me/stats/summary?days=30
 * Retorna resumo agregado do período (totais e rates).
 */
router.get('/me/stats/summary', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));
        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;
        let days = Number(req.query.days) || 30;
        if (!Number.isFinite(days) || days <= 0) days = 30;
        days = Math.min(Math.max(days, 1), 180);
        const summary = await userStatsService.getSummary(user.Id || user.id, days);
        return res.json(summary);
    } catch (err) {
        logger.error('Erro user stats summary:', err);
        return next(internalError('Internal error', 'USER_STATS_SUMMARY_ERROR', err));
    }
});

/**
 * PUT /api/users/me/profile
 * Atualiza Nome e NomeUsuario do usuário autenticado
 */
router.put('/me/profile', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));

        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;

        const { Nome, NomeUsuario } = req.body || {};
        
        if (!Nome || !Nome.trim()) {
            return next(badRequest('Nome é obrigatório', 'NAME_REQUIRED'));
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
        logger.error('Erro ao atualizar perfil:', err);
        return next(internalError('Erro interno', 'USER_PROFILE_UPDATE_ERROR', err));
    }
});

/**
 * POST /api/users/me/email/request-change
 * Solicita alteração de email e envia código de verificação
 */
router.post('/me/email/request-change', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));

        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;

        const { newEmail } = req.body || {};
        
        if (!newEmail || !newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
            return next(badRequest('Email inválido', 'INVALID_EMAIL'));
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
                logger.warn(`[SECURITY] User ${currentUserId} attempted to change email to already registered email: ${emailLower} (owner: ${existingId})`);
                return next(conflict('Este email já está em uso', 'EMAIL_IN_USE'));
            }
            // If same user, they already have this email - no change needed
            return next(badRequest('Este já é o seu email atual', 'EMAIL_SAME_AS_CURRENT'));
        }

        // Invalidar tokens anteriores não usados de troca de email para este usuário
        const existingTokens = await EmailVerification.findAll({
            where: {
                UserId: user.Id,
                Used: false
            }
        });

        for (const oldToken of existingTokens) {
            try {
                const oldMeta = oldToken.Meta ? JSON.parse(oldToken.Meta) : {};
                if (oldMeta.type === 'email_change') {
                    // Força expiração do token
                    await oldToken.update({ ForcedExpiration: true });
                    logger.info(`[email-change] Token anterior ${oldToken.Token} forçadamente expirado para UserId ${user.Id}`);
                }
            } catch (e) {
                logger.warn('[email-change] Erro ao processar meta de token antigo:', e);
            }
        }

        // Create verification token
        const token = generateVerificationCode(6).toUpperCase();
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
        logger.error('Erro ao solicitar alteração de email:', err);
        return next(internalError('Erro interno', 'USER_EMAIL_REQUEST_CHANGE_ERROR', err));
    }
});

/**
 * POST /api/users/me/email/verify-change
 * Verifica código e efetua alteração de email
 */
router.post('/me/email/verify-change', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));

        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;

        const { newEmail, token } = req.body || {};
        
        if (!token || !token.trim()) {
            return next(badRequest('Código de verificação obrigatório', 'VERIFICATION_CODE_REQUIRED'));
        }

        const tokenUpper = token.trim().toUpperCase();

        // Find verification record
        const verification = await EmailVerification.findOne({
            where: {
                UserId: user.Id,
                Token: tokenUpper,
                Used: false
            },
            order: [['CreatedAt', 'DESC']]
        });

        if (!verification) {
            return next(badRequest('Código inválido ou já utilizado', 'INVALID_OR_USED_CODE'));
        }

        if (verification.ForcedExpiration) {
            return next(badRequest('Este código foi invalidado porque você solicitou um novo. Use o código mais recente.', 'CODE_FORCED_EXPIRED'));
        }

        if (new Date() > new Date(verification.ExpiresAt)) {
            return next(badRequest('Código expirado', 'CODE_EXPIRED'));
        }

        // Verify metadata matches
        let meta = {};
        try {
            meta = JSON.parse(verification.Meta || '{}');
        } catch(_) { }

        if (meta.type !== 'email_change' || meta.newEmail !== newEmail.trim().toLowerCase()) {
            return next(badRequest('Código não corresponde à solicitação', 'CODE_MISMATCH'));
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
        logger.error('Erro ao verificar alteração de email:', err);
        return next(internalError('Erro interno', 'USER_EMAIL_VERIFY_CHANGE_ERROR', err));
    }
});

/**
 * POST /api/users/me/verify-password
 * Verifica se a senha fornecida está correta (para autenticação adicional)
 */
router.post('/me/verify-password', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));

        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;

        const { password } = req.body || {};
        
        if (!password) {
            return next(badRequest('Senha é obrigatória', 'PASSWORD_REQUIRED'));
        }

        // Debug logging
        logger.info('[verify-password] User:', user.Email);
        logger.info('[verify-password] SHA-256 received (first 20 chars):', password.substring(0, 20));
        logger.info('[verify-password] Bcrypt stored (first 20 chars):', user.SenhaHash.substring(0, 20));

        // Password comes as SHA-256 hash from client (same as login)
        // Server stored hash is bcrypt(SHA-256)
        const isValid = await bcrypt.compare(password, user.SenhaHash);
        
        logger.info('[verify-password] Comparison result:', isValid);
        
        if (!isValid) {
            return next(unauthorized('Senha incorreta', 'INVALID_PASSWORD'));
        }

        return res.json({ message: 'Senha verificada com sucesso' });
    } catch (err) {
        logger.error('Erro ao verificar senha:', err);
        return next(internalError('Erro interno', 'USER_VERIFY_PASSWORD_ERROR', err));
    }
});

/**
 * PUT /api/users/me/password
 * Altera senha do usuário autenticado
 */
router.put('/me/password', async (req, res, next) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || '').trim();
        if (!sessionToken) return next(badRequest('X-Session-Token required', 'SESSION_TOKEN_REQUIRED'));

        const authRes = await verifyJwtAndGetActiveUser(sessionToken);
        if (!authRes.ok) return next(unauthorized(authRes.message, authRes.code));
        const user = authRes.user;

        const { currentPassword, newPassword } = req.body || {};
        
        if (!currentPassword || !newPassword) {
            return next(badRequest('Senha atual e nova senha são obrigatórias', 'PASSWORDS_REQUIRED'));
        }

        if (newPassword.length < 6) {
            return next(badRequest('Nova senha deve ter no mínimo 6 caracteres', 'PASSWORD_TOO_SHORT'));
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.SenhaHash);
        if (!isValid) {
            return next(unauthorized('Senha atual incorreta', 'INVALID_PASSWORD'));
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        user.SenhaHash = newHash;
        user.DataAlteracao = new Date();
        await user.save();

        return res.json({ message: 'Senha alterada com sucesso' });
    } catch (err) {
        logger.error('Erro ao alterar senha:', err);
        return next(internalError('Erro interno', 'USER_CHANGE_PASSWORD_ERROR', err));
    }
});

module.exports = router;