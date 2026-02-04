const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../models');
const { User, EmailVerification } = db;
const Op = db.Sequelize && db.Sequelize.Op;
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendVerificationEmail } = require('../utils/mailer');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/security');
const { authSchemas, validate } = require('../middleware/validation');
const { logger, security, audit } = require('../utils/logger');
const { badRequest, unauthorized, forbidden, notFound, tooManyRequests, internalError } = require('../middleware/errors');
const { generateSessionId, upsertActiveSession, verifyJwtAndGetActiveUser, extractTokenFromRequest } = require('../utils/singleSession');
const { getCookieDomainForRequest } = require('../utils/cookieDomain');
const { enforcePremiumExpiry } = require('../services/premiumExpiry');

function isPasswordExpired(user) {
    try {
        if (!user) return false;
        if (user.PwdExpired === true) return true;
        if (!user.PwdExpiredDate) return false;
        const t = new Date(user.PwdExpiredDate).getTime();
        if (!Number.isFinite(t)) return false;
        return t <= Date.now();
    } catch (_) {
        return false;
    }
}

function isRestrictedForExpiredPassword(user) {
    try {
        if (!user) return true;
        if (user.BloqueioAtivado === true) return true;
        if (user.EmailConfirmado !== true) return true;
        if (user.Excluido === true) return true;
        return false;
    } catch (_) {
        return true;
    }
}

// Explicitly set bcrypt rounds for password hashing security
const BCRYPT_ROUNDS = 12;

// Mitigate timing-based user enumeration: make "user not found" take roughly
// the same time as an invalid password check by doing a dummy bcrypt compare.
let DUMMY_BCRYPT_HASH = null;
try {
    DUMMY_BCRYPT_HASH = bcrypt.hashSync('0'.repeat(64), BCRYPT_ROUNDS);
} catch (_) {
    DUMMY_BCRYPT_HASH = null;
}

function isHttpsRequest(req) {
    try {
        if (req && req.secure) return true;
        const xf = (req && req.headers && req.headers['x-forwarded-proto']) ? String(req.headers['x-forwarded-proto']) : '';
        return xf.toLowerCase().includes('https');
    } catch (_) {
        return false;
    }
}

// Strict rate limiter for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window per IP
  skipSuccessfulRequests: true, // Don't count successful logins
  message: 'Muitas tentativas de login. Aguarde 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
    handler: (req, res, next) => {
    security.rateLimitExceeded(req);
        return next(tooManyRequests('Muitas tentativas de login. Aguarde 15 minutos.'));
  }
});

// Rate limiter for password reset requests
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window per IP
  message: 'Muitas tentativas de recuperação de senha. Aguarde 1 hora.',
  standardHeaders: true,
  legacyHeaders: false,
    handler: (req, res, next) => {
    security.rateLimitExceeded(req);
        return next(tooManyRequests('Muitas tentativas de recuperação de senha. Aguarde 1 hora.'));
  }
});

// Rate limiter for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  message: 'Muitas tentativas de registro. Aguarde 1 hora.',
  standardHeaders: true,
  legacyHeaders: false,
    handler: (req, res, next) => {
    security.rateLimitExceeded(req);
        return next(tooManyRequests('Muitas tentativas de registro. Aguarde 1 hora.'));
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, validate(authSchemas.login), async (req, res, next) => {
    try {
        const body = req.body || {};
        if (!body.Email || typeof body.Email !== 'string') {
            return next(badRequest('Usuário ou e-mail obrigatório', 'IDENTIFIER_REQUIRED'));
        }
        if (!body.SenhaHash || typeof body.SenhaHash !== 'string') {
            return next(badRequest('Senha obrigatória', 'PASSWORD_REQUIRED'));
        }

        const identifier = body.Email.trim().toLowerCase();

        let user = null;
        if (Op) {
            user = await User.findOne({
                where: {
                    [Op.or]: [
                        { Email: identifier },
                        { NomeUsuario: identifier }
                    ]
                }
            });
        } else {
            user = await User.findOne({ where: { Email: identifier } });
            if (!user) user = await User.findOne({ where: { NomeUsuario: identifier } });
        }
        if (!user) {
            // Usuário inexistente: não há onde registrar falha
            security.loginFailure(req, identifier, 'user_not_found');
            // Dummy compare to reduce timing oracle for account existence
            try { if (DUMMY_BCRYPT_HASH) await bcrypt.compare(body.SenhaHash, DUMMY_BCRYPT_HASH); } catch (_) {}
            return next(unauthorized('Credenciais inválidas', 'INVALID_CREDENTIALS'));
        }

        // Verifica bloqueio temporário por FimBloqueio
        try {
            const now = Date.now();
            const until = user.FimBloqueio ? new Date(user.FimBloqueio).getTime() : 0;
            if (until && until > now) {
                const secondsLeft = Math.ceil((until - now) / 1000);
                security.loginFailure(req, identifier, 'account_locked');
                security.suspiciousActivity(req, `Account locked until ${new Date(until).toISOString()} - repeated failed attempts`);
                                return next(new (require('../middleware/errorHandler').AppError)(
                                    'Muitas tentativas de login. Sua conta foi bloqueada temporariamente. Aguarde 5 minutos antes de tentar novamente.',
                                    423,
                                    'ACCOUNT_LOCKED',
                                    { lockoutUntil: new Date(until).toISOString(), lockoutSecondsLeft: secondsLeft }
                                ));
            }
        } catch (_) { /* ignore */ }

        // If email not confirmed, create/send verification token and ask user to validate.
        // Security hardening: avoid spamming emails by reusing a recent valid token.
        if (!user.EmailConfirmado) {
            try {
                // If we recently issued a verification token (and it is still valid), reuse it.
                try {
                    const recent = await EmailVerification.findOne({
                        where: {
                            UserId: user.Id,
                            Used: false,
                            ForcedExpiration: false
                        },
                        order: [['CreatedAt', 'DESC']]
                    });
                    if (recent) {
                        let isEmailVerificationToken = true;
                        try {
                            const meta = recent.Meta ? JSON.parse(recent.Meta) : {};
                            // Password reset / email change tokens are not email-verification tokens.
                            if (meta && (meta.type === 'password_reset' || meta.type === 'email_change')) {
                                isEmailVerificationToken = false;
                            }
                        } catch (_) {}

                        if (isEmailVerificationToken) {
                            const createdAt = recent.CreatedAt ? new Date(recent.CreatedAt).getTime() : 0;
                            const expiresAt = recent.ExpiresAt ? new Date(recent.ExpiresAt).getTime() : 0;
                            const now = Date.now();
                            const isFresh = createdAt && (now - createdAt) < (2 * 60 * 1000);
                            const notExpired = !expiresAt || expiresAt > now;
                            if (isFresh && notExpired) {
                                // Don't send another email; keep same token active.
                                security.loginFailure(req, identifier, 'email_not_confirmed_recent_token');
                                return next(forbidden('E-mail não confirmado. Enviamos um token para o seu e-mail.', 'EMAIL_NOT_CONFIRMED'));
                            }
                        }
                    }
                } catch (_) { /* ignore */ }

                // Invalidar tokens anteriores não usados de verificação de email para este usuário
                const existingTokens = await EmailVerification.findAll({
                    where: {
                        UserId: user.Id,
                        Used: false
                    }
                });

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

                for (const oldToken of existingTokens) {
                    try {
                        const oldMeta = oldToken.Meta ? JSON.parse(oldToken.Meta) : {};
                        // Se não tem meta ou se é verificação de email (não tem type ou type não é password_reset/email_change)
                        if (!oldMeta.type || (oldMeta.type !== 'password_reset' && oldMeta.type !== 'email_change')) {
                            await oldToken.update({ ForcedExpiration: true });
                            logger.info(`[login-email-verification] Token anterior ${oldToken.Token} forçadamente expirado para UserId ${user.Id}`);
                        }
                    } catch (e) {
                        logger.warn('[login-email-verification] Erro ao processar meta de token antigo:', e);
                    }
                }

                const token = require('../utils/codegen').generateVerificationCode(6).toUpperCase();
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                await EmailVerification.create({ UserId: user.Id, Token: token, ExpiresAt: expiresAt, Used: false, CreatedAt: new Date() });
                
                await sendVerificationEmail(user.Email, token);
            } catch (e) {
                logger.error('Erro criando/enviando token verificação no login:', e);
            }
            security.loginFailure(req, identifier, 'email_not_confirmed');
            return next(forbidden('E-mail não confirmado. Enviamos um token para o seu e-mail.', 'EMAIL_NOT_CONFIRMED'));
        }

        if (!user.SenhaHash) {
            // Conta sem senha definida – registra falha
            try {
                const current = Number(user.AccessFailedCount || 0);
                const next = current + 1;
                let patch = { AccessFailedCount: next, DataAlteracao: new Date() };
                // aplica bloqueio após 3 falhas
                if (next >= 3) {
                    const until = new Date(Date.now() + 5 * 60 * 1000);
                    patch = { ...patch, AccessFailedCount: 0, FimBloqueio: until };
                }
                await user.update(patch);
            } catch (_) { /* ignore */ }
            return next(unauthorized('Usuário sem senha cadastrada', 'USER_WITHOUT_PASSWORD'));
        }

        const match = await bcrypt.compare(body.SenhaHash, user.SenhaHash);
        if (!match) {
            // Senha incorreta – incrementa contador de falhas
            try {
                const current = Number(user.AccessFailedCount || 0);
                const next = current + 1;
                let patch = { AccessFailedCount: next, DataAlteracao: new Date() };
                // aplica bloqueio após 3 falhas
                if (next >= 3) {
                    const until = new Date(Date.now() + 5 * 60 * 1000);
                    patch = { ...patch, AccessFailedCount: 0, FimBloqueio: until };
                }
                await user.update(patch);
            } catch (_) { /* ignore */ }
            return next(unauthorized('Credenciais inválidas', 'INVALID_CREDENTIALS'));
        }

        // Após validar a senha, aplica regra centralizada de expiração do premium.
        // (timestamp completo, incluindo minutos/segundos)
        try { await enforcePremiumExpiry(user); } catch (_) { /* best-effort */ }

        // Deny login if password is expired.
        // Note: we still treat this as a login failure, but credentials were correct.
        if (isPasswordExpired(user)) {
            security.loginFailure(req, identifier, 'password_expired');

            const restricted = isRestrictedForExpiredPassword(user);
            try {
                // Best-effort: clear lockout counters since credentials are correct.
                const patch = { DataAlteracao: new Date() };
                if (Number(user.AccessFailedCount || 0) !== 0) patch.AccessFailedCount = 0;
                if (user.FimBloqueio) patch.FimBloqueio = null;
                await user.update(patch);
            } catch (_) { /* ignore */ }

            if (restricted) {
                return next(forbidden('Senha expirada. Sua conta está restrita e não pode alterar a senha no login.', 'PASSWORD_EXPIRED_ACCOUNT_RESTRICTED', {
                    pwdExpired: true,
                    canChangeExpiredPassword: false,
                    pwdExpiredDate: user.PwdExpiredDate ? new Date(user.PwdExpiredDate).toISOString() : null,
                }));
            }

            return next(forbidden('Senha expirada. Defina uma nova senha para continuar.', 'PASSWORD_EXPIRED', {
                pwdExpired: true,
                canChangeExpiredPassword: true,
                pwdExpiredDate: user.PwdExpiredDate ? new Date(user.PwdExpiredDate).toISOString() : null,
            }));
        }

        // Successful login - return minimal user info
        // Zera o contador de falhas, se necessário
        try {
            const patch = { DataAlteracao: new Date() };
            if (Number(user.AccessFailedCount || 0) !== 0) patch.AccessFailedCount = 0;
            if (user.FimBloqueio) patch.FimBloqueio = null; // limpa bloqueio antigo
            // Normalização: se NomeUsuario ainda é um guest_*#, renomeia para o e-mail
            if (user.NomeUsuario && /^guest_/.test(user.NomeUsuario) && user.Email) {
                patch.NomeUsuario = user.Email.toLowerCase();
                logger.debug('[auth:login] Normalizando NomeUsuario guest_* para email:', patch.NomeUsuario);
            }
            await user.update(patch);
        } catch (_) { /* ignore */ }
        // Issue JWT for protected endpoints (e.g., indicators)
        let token = null;
        try {
            const sid = generateSessionId();
            await upsertActiveSession(user.Id, sid);

            const payload = { sub: user.Id, sid, email: user.Email, name: user.NomeUsuario };
            const expiresIn = process.env.JWT_EXPIRES_IN || '12h';
            token = jwt.sign(payload, jwtSecret, { expiresIn });
            
            // Set httpOnly cookie for secure token storage
            const cookieOptions = {
                httpOnly: true,
                // Prefer actual request scheme to avoid accidentally issuing non-secure cookies behind proxies.
                secure: isHttpsRequest(req) || process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
                path: '/',
                domain: getCookieDomainForRequest(req)
            };
            res.cookie('sessionToken', token, cookieOptions);
        } catch (e) { logger.warn('JWT sign error, token omitido:', e && e.message); }

        // Log successful login
        security.loginSuccess(req, user);

        return res.json({
            Id: user.Id,
            NomeUsuario: user.NomeUsuario,
            Nome: user.Nome,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado,
            token, // Still return token for backward compatibility
            tokenType: token ? 'Bearer' : null
        });

        // Best-effort: clear legacy Domain=.localhost variant too.
        try {
            const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
            if (!isProd) {
                const hostRaw = String(req.get('host') || '').replace(/:\d+$/, '').toLowerCase();
                if (hostRaw === 'localhost' || hostRaw.endsWith('.localhost')) {
                    res.clearCookie('sessionToken', { domain: '.localhost', path: '/' });
                }
            }
        } catch (_) {}
    } catch (err) {
        logger.error('Erro em /api/auth/login:', err);
        return next(internalError('Erro interno', 'INTERNAL_ERROR_LOGIN'));
    }
});

// POST /api/auth/change-expired-password
// Body: { identifier, currentPasswordHash, newPasswordHash }
// Used when login is denied due to PASSWORD_EXPIRED but account is eligible.
router.post('/change-expired-password', loginLimiter, validate(authSchemas.changeExpiredPassword), async (req, res, next) => {
    try {
        const body = req.body || {};
        const identifier = String(body.identifier || '').trim().toLowerCase();
        const currentPasswordHash = String(body.currentPasswordHash || '').trim();
        const newPasswordHash = String(body.newPasswordHash || '').trim();

        let user = null;
        if (Op) {
            user = await User.findOne({
                where: {
                    [Op.or]: [
                        { Email: identifier },
                        { NomeUsuario: identifier }
                    ]
                }
            });
        } else {
            user = await User.findOne({ where: { Email: identifier } });
            if (!user) user = await User.findOne({ where: { NomeUsuario: identifier } });
        }

        if (!user) {
            security.loginFailure(req, identifier, 'user_not_found_expired_change');
            return next(unauthorized('Credenciais inválidas', 'INVALID_CREDENTIALS'));
        }

        // Respect lockout window.
        try {
            const now = Date.now();
            const until = user.FimBloqueio ? new Date(user.FimBloqueio).getTime() : 0;
            if (until && until > now) {
                const secondsLeft = Math.ceil((until - now) / 1000);
                return next(new (require('../middleware/errorHandler').AppError)(
                    'Muitas tentativas. Sua conta foi bloqueada temporariamente. Aguarde 5 minutos antes de tentar novamente.',
                    423,
                    'ACCOUNT_LOCKED',
                    { lockoutUntil: new Date(until).toISOString(), lockoutSecondsLeft: secondsLeft }
                ));
            }
        } catch (_) { /* ignore */ }

        // Must be expired to use this flow.
        if (!isPasswordExpired(user)) {
            return next(forbidden('Operação não permitida.', 'OPERATION_NOT_ALLOWED'));
        }

        // If expired, additional restrictions apply.
        if (isRestrictedForExpiredPassword(user)) {
            return next(forbidden('Não é permitido alterar a senha nesta conta (senha expirada + conta restrita).', 'PASSWORD_EXPIRED_ACCOUNT_RESTRICTED'));
        }

        if (!user.SenhaHash) {
            return next(unauthorized('Credenciais inválidas', 'INVALID_CREDENTIALS'));
        }

        const match = await bcrypt.compare(currentPasswordHash, user.SenhaHash);
        if (!match) {
            // Incorrect current password – increment lockout counters like login.
            try {
                const current = Number(user.AccessFailedCount || 0);
                const nextCount = current + 1;
                let patch = { AccessFailedCount: nextCount, DataAlteracao: new Date() };
                if (nextCount >= 3) {
                    const until = new Date(Date.now() + 5 * 60 * 1000);
                    patch = { ...patch, AccessFailedCount: 0, FimBloqueio: until };
                }
                await user.update(patch);
            } catch (_) { /* ignore */ }
            return next(unauthorized('Credenciais inválidas', 'INVALID_CREDENTIALS'));
        }

        // Enforce: new password must differ from the current password.
        // (Client sends SHA-256 hex; stored hash is bcrypt(SHA-256).)
        if (newPasswordHash && currentPasswordHash && newPasswordHash === currentPasswordHash) {
            return next(badRequest('A nova senha deve ser diferente da senha atual.', 'NEW_PASSWORD_SAME_AS_CURRENT'));
        }
        try {
            const sameAsCurrent = await bcrypt.compare(newPasswordHash, user.SenhaHash);
            if (sameAsCurrent) {
                return next(badRequest('A nova senha deve ser diferente da senha atual.', 'NEW_PASSWORD_SAME_AS_CURRENT'));
            }
        } catch (_) { /* ignore */ }

        // Store bcrypt(SHA-256 hex) and clear expiration flags.
        const bcryptHash = await bcrypt.hash(newPasswordHash, BCRYPT_ROUNDS);
        await user.update({
            SenhaHash: bcryptHash,
            PwdExpired: false,
            PwdExpiredDate: null,
            AccessFailedCount: 0,
            FimBloqueio: null,
            DataAlteracao: new Date(),
        });

        return res.json({ success: true, message: 'Senha alterada com sucesso. Agora faça login.' });
    } catch (err) {
        logger.error('Erro em /api/auth/change-expired-password:', err);
        return next(internalError('Erro interno', 'INTERNAL_ERROR_CHANGE_EXPIRED_PASSWORD'));
    }
});

// POST /api/auth/verify - body: { token }
router.post('/verify', validate(authSchemas.verify), async (req, res, next) => {
    try {
        const token = req.body.token.trim().toUpperCase();
        const identifierRaw = (req.body && req.body.identifier != null) ? String(req.body.identifier) : '';
        const identifier = identifierRaw.trim().toLowerCase();

        const now = new Date();
        let record = null;
        let user = null;

        // If an identifier is provided, bind the token to that specific user.
        if (identifier) {
            if (Op) {
                user = await User.findOne({
                    where: {
                        [Op.or]: [
                            { Email: identifier },
                            { NomeUsuario: identifier }
                        ]
                    }
                });
            } else {
                user = await User.findOne({ where: { Email: identifier } });
                if (!user) user = await User.findOne({ where: { NomeUsuario: identifier } });
            }

            if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));
            record = await EmailVerification.findOne({ where: { Token: token, Used: false, UserId: user.Id } });
        } else {
            // Backward-compatible behavior: token-only lookup (global)
            record = await EmailVerification.findOne({ where: { Token: token, Used: false } });
        }
        if (!record) return next(badRequest('Token inválido ou já utilizado', 'INVALID_TOKEN'));
        if (record.ForcedExpiration) return next(badRequest('Este código foi invalidado porque você solicitou um novo. Use o código mais recente.', 'TOKEN_FORCED_EXPIRED'));
        if (record.ExpiresAt && new Date(record.ExpiresAt) < now) return next(badRequest('Token expirado', 'TOKEN_EXPIRED'));

        // mark used and set user email confirmed
        record.Used = true;
        await record.save();

        if (!user) user = await User.findByPk(record.UserId);
        if (user) {
            user.EmailConfirmado = true;
            user.DataAlteracao = new Date();
            await user.save();
        }

        return res.json({ message: 'E-mail confirmado com sucesso', userId: record.UserId });
    } catch (err) {
        logger.error('Erro em /api/auth/verify:', err);
        return next(internalError('Erro interno', 'INTERNAL_ERROR_VERIFY'));
    }
});

// POST /api/auth/forgot-password
// Solicita código de reset de senha
router.post('/forgot-password', resetLimiter, validate(authSchemas.forgotPassword), async (req, res, next) => {
    try {
        logger.info('[forgot-password] Iniciando processo de recuperação de senha');
        const { email } = req.body;
        
        const emailLower = email.trim().toLowerCase();
        logger.info('[forgot-password] Buscando usuário com email:', emailLower);
        const user = await User.findOne({ where: { Email: emailLower } });
        
        if (!user) {
            logger.info('[forgot-password] Usuário não encontrado, retornando resposta genérica');
            // Por segurança, não revelar se o email existe ou não
            return res.json({ message: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' });
        }

        logger.info('[forgot-password] Usuário encontrado, UserId:', user.Id);
        
        // Invalidar tokens anteriores não usados do mesmo tipo para este usuário
        const existingTokens = await EmailVerification.findAll({
            where: {
                UserId: user.Id,
                Used: false
            }
        });

        logger.info(`[forgot-password] Encontrados ${existingTokens.length} tokens não usados`);

        let expiredCount = 0;
        for (const oldToken of existingTokens) {
            try {
                const oldMeta = oldToken.Meta ? JSON.parse(oldToken.Meta) : {};
                logger.info(`[forgot-password] Verificando token ${oldToken.Token}, meta:`, oldMeta);
                if (oldMeta.type === 'password_reset') {
                    // Força expiração do token ajustando ForcedExpiration
                    await oldToken.update({ ForcedExpiration: true });
                    expiredCount++;
                    logger.info(`[forgot-password] ✓ Token ${oldToken.Token} forçadamente expirado (ForcedExpiration=true)`);
                }
            } catch (e) {
                logger.warn('[forgot-password] Erro ao processar meta de token antigo:', e);
            }
        }
        
        logger.info(`[forgot-password] Total de tokens expirados: ${expiredCount}`);

        // Gerar novo código de verificação
        const token = require('../utils/codegen').generateVerificationCode(6).toUpperCase();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        // Criar registro de verificação com meta indicando que é reset de senha
        await EmailVerification.create({
            UserId: user.Id,
            Token: token,
            ExpiresAt: expiresAt,
            Used: false,
            CreatedAt: new Date(),
            Meta: JSON.stringify({ type: 'password_reset', email: emailLower })
        });

        // Enviar email com código
        await sendVerificationEmail(emailLower, token, 'recuperação de senha');

        // Log password reset request
        security.passwordResetRequest(req, emailLower);

        return res.json({ message: 'Código enviado para o e-mail informado.' });
    } catch (err) {
        logger.error('Erro em /api/auth/forgot-password:', err);
        return next(internalError('Erro ao processar solicitação', 'INTERNAL_ERROR_FORGOT_PASSWORD'));
    }
});

// POST /api/auth/reset-password
// Reseta senha usando código de verificação
router.post('/reset-password', resetLimiter, validate(authSchemas.resetPassword), async (req, res, next) => {
    try {
        const { email, token, senhaHash } = req.body;

        const emailLower = email.trim().toLowerCase();
        const tokenUpper = token.trim().toUpperCase();

        // Buscar usuário
        const user = await User.findOne({ where: { Email: emailLower } });
        if (!user) {
            return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));
        }

        // Primeiro, buscar qualquer código com este token para este usuário (independente de Used)
        const allVerifications = await EmailVerification.findAll({
            where: {
                UserId: user.Id,
                Token: tokenUpper
            },
            order: [['CreatedAt', 'DESC']]
        });

        if (!allVerifications || allVerifications.length === 0) {
            return next(badRequest('Código inválido. Verifique se digitou corretamente.', 'INVALID_CODE'));
        }

        // Pegar o mais recente
        const verification = allVerifications[0];

        // Verificar se já foi usado
        if (verification.Used) {
            return next(badRequest('Este código já foi utilizado. Solicite um novo código.', 'CODE_ALREADY_USED'));
        }

        // Verificar se foi forçadamente expirado
        if (verification.ForcedExpiration) {
            return next(badRequest('Este código foi invalidado porque você solicitou um novo. Use o código mais recente.', 'CODE_FORCED_EXPIRED'));
        }

        // Verificar se código expirou naturalmente
        if (new Date() > new Date(verification.ExpiresAt)) {
            return next(badRequest('Código expirado. Solicite um novo código.', 'CODE_EXPIRED'));
        }

        // Verificar se o código é realmente para reset de senha
        try {
            const meta = verification.Meta ? JSON.parse(verification.Meta) : {};
            if (meta.type !== 'password_reset') {
                return next(badRequest('Este código não é válido para recuperação de senha.', 'CODE_NOT_FOR_PASSWORD_RESET'));
            }
        } catch (_) {
            // Se não tem meta, considerar inválido para reset
            return next(badRequest('Este código não é válido para recuperação de senha.', 'CODE_NOT_FOR_PASSWORD_RESET'));
        }

        // If password is expired, enforce additional restrictions.
        if (isPasswordExpired(user) && isRestrictedForExpiredPassword(user)) {
            return next(forbidden('Não é permitido alterar a senha nesta conta (senha expirada + conta restrita).', 'PASSWORD_EXPIRED_ACCOUNT_RESTRICTED'));
        }

        // Enforce: new password must differ from the current password (if one exists).
        // (Client sends SHA-256 hex; stored hash is bcrypt(SHA-256).)
        if (user.SenhaHash) {
            try {
                const sameAsCurrent = await bcrypt.compare(String(senhaHash || '').trim(), user.SenhaHash);
                if (sameAsCurrent) {
                    return next(badRequest('A nova senha deve ser diferente da senha atual.', 'NEW_PASSWORD_SAME_AS_CURRENT'));
                }
            } catch (_) { /* ignore */ }
        }

        // Hash da senha com bcrypt (servidor)
        const hashedPassword = await bcrypt.hash(senhaHash, BCRYPT_ROUNDS);

        // Atualizar senha do usuário (and clear expiration flags)
        await user.update({
            SenhaHash: hashedPassword,
            PwdExpired: false,
            PwdExpiredDate: null,
            DataAlteracao: new Date(),
        });

        // Marcar código como usado
        await verification.update({ Used: true });

        // Log successful password reset
        security.passwordResetSuccess(req, emailLower);

        return res.json({ message: 'Senha alterada com sucesso' });
    } catch (err) {
        logger.error('Erro em /api/auth/reset-password:', err);
        return next(internalError('Erro ao resetar senha', 'INTERNAL_ERROR_RESET_PASSWORD'));
    }
});

module.exports = router;

// GET /api/auth/me - resolve user by cookie sessionToken, X-Session-Token header or query parameter
router.get('/me', async (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);
        const result = await verifyJwtAndGetActiveUser(token);
        if (!result.ok) {
            if (result.status === 401) return next(unauthorized(result.message, result.code));
            if (result.status === 403) return next(forbidden(result.message, result.code));
            return next(unauthorized(result.message, result.code));
        }
        const user = result.user;

        return res.json({
            Id: user.Id,
            NomeUsuario: user.NomeUsuario,
            Nome: user.Nome,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado,
            PremiumExpiresAt: user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).toISOString() : null,
            PremiumExpiredAt: user.PremiumExpiredAt ? new Date(user.PremiumExpiredAt).toISOString() : null
        });
    } catch (err) {
        logger.error('Erro em /api/auth/me:', err);
        return next(internalError('Erro interno', 'INTERNAL_ERROR_ME'));
    }
});

// POST /api/auth/logout - Clear httpOnly cookie and cleanup session
router.post('/logout', async (req, res, next) => {
    try {
        // Best-effort: clear active session entry for this token (if present)
        try {
            const token = extractTokenFromRequest(req);
            const result = await verifyJwtAndGetActiveUser(token);
            if (result && result.ok && result.decoded && result.decoded.sub) {
                const { clearActiveSession } = require('../utils/singleSession');
                await clearActiveSession(Number(result.decoded.sub), String(result.decoded.sid || ''));
            }
        } catch (_) { /* ignore */ }

        // Clear the httpOnly cookie
        res.clearCookie('sessionToken', {
            httpOnly: true,
            secure: isHttpsRequest(req) || process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/',
            domain: getCookieDomainForRequest(req)
        });
        
        return res.json({ 
            success: true, 
            message: 'Logout realizado com sucesso' 
        });
    } catch (err) {
        logger.error('Erro em /api/auth/logout:', err);
        return next(internalError('Erro interno', 'INTERNAL_ERROR_LOGOUT'));
    }
});
