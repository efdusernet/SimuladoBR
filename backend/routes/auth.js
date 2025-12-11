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
const { security, audit } = require('../utils/logger');

// Explicitly set bcrypt rounds for password hashing security
const BCRYPT_ROUNDS = 12;

// Strict rate limiter for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window per IP
  skipSuccessfulRequests: true, // Don't count successful logins
  message: 'Muitas tentativas de login. Aguarde 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    security.rateLimitExceeded(req);
    res.status(429).json({ message: 'Muitas tentativas de login. Aguarde 15 minutos.' });
  }
});

// Rate limiter for password reset requests
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window per IP
  message: 'Muitas tentativas de recuperação de senha. Aguarde 1 hora.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    security.rateLimitExceeded(req);
    res.status(429).json({ message: 'Muitas tentativas de recuperação de senha. Aguarde 1 hora.' });
  }
});

// Rate limiter for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  message: 'Muitas tentativas de registro. Aguarde 1 hora.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    security.rateLimitExceeded(req);
    res.status(429).json({ message: 'Muitas tentativas de registro. Aguarde 1 hora.' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, validate(authSchemas.login), async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.Email || typeof body.Email !== 'string') {
            return res.status(400).json({ message: 'Email obrigatório' });
        }
        if (!body.SenhaHash || typeof body.SenhaHash !== 'string') {
            return res.status(400).json({ message: 'Senha obrigatória' });
        }

        const email = body.Email.trim().toLowerCase();
        const user = await User.findOne({ where: { Email: email } });
        if (!user) {
            // Usuário inexistente: não há onde registrar falha
            security.loginFailure(req, email, 'user_not_found');
            return res.status(401).json({ message: 'Credenciais inválidas' });
        }

        // Verifica bloqueio temporário por FimBloqueio
        try {
            const now = Date.now();
            const until = user.FimBloqueio ? new Date(user.FimBloqueio).getTime() : 0;
            if (until && until > now) {
                const secondsLeft = Math.ceil((until - now) / 1000);
                security.loginFailure(req, email, 'account_locked');
                security.suspiciousActivity(req, `Account locked until ${new Date(until).toISOString()} - repeated failed attempts`);
                return res.status(423).json({
                    message: 'Muitas tentativas de login. Sua conta foi bloqueada temporariamente. Aguarde 5 minutos antes de tentar novamente.',
                    lockoutUntil: new Date(until).toISOString(),
                    lockoutSecondsLeft: secondsLeft
                });
            }
        } catch (_) { /* ignore */ }

        // If email not confirmed, create/send verification token and ask user to validate
        if (!user.EmailConfirmado) {
            try {
                // Invalidar tokens anteriores não usados de verificação de email para este usuário
                const existingTokens = await EmailVerification.findAll({
                    where: {
                        UserId: user.Id,
                        Used: false
                    }
                });

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
            security.loginFailure(req, email, 'email_not_confirmed');
            return res.status(403).json({ message: 'E-mail não confirmado. Enviamos um token para o seu e-mail.' });
        }

        if (!user.SenhaHash) {
            // Conta sem senha definida – registra falha
            try {
                const current = Number(user.AccessFailedCount || 0);
                const next = current + 1;
                let patch = { AccessFailedCount: next, DataAlteracao: new Date() };
                // aplica bloqueio após 5 falhas
                if (next >= 5) {
                    const until = new Date(Date.now() + 5 * 60 * 1000);
                    patch = { ...patch, AccessFailedCount: 0, FimBloqueio: until };
                }
                await user.update(patch);
            } catch (_) { /* ignore */ }
            return res.status(401).json({ message: 'Usuário sem senha cadastrada' });
        }

        const match = await bcrypt.compare(body.SenhaHash, user.SenhaHash);
        if (!match) {
            // Senha incorreta – incrementa contador de falhas
            try {
                const current = Number(user.AccessFailedCount || 0);
                const next = current + 1;
                let patch = { AccessFailedCount: next, DataAlteracao: new Date() };
                // aplica bloqueio após 5 falhas
                if (next >= 5) {
                    const until = new Date(Date.now() + 5 * 60 * 1000);
                    patch = { ...patch, AccessFailedCount: 0, FimBloqueio: until };
                }
                await user.update(patch);
            } catch (_) { /* ignore */ }
            return res.status(401).json({ message: 'Credenciais inválidas' });
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
            const payload = { sub: user.Id, email: user.Email, name: user.NomeUsuario };
            const expiresIn = process.env.JWT_EXPIRES_IN || '12h';
            token = jwt.sign(payload, jwtSecret, { expiresIn });
            
            // Set httpOnly cookie for secure token storage
            const cookieOptions = {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // HTTPS only in production
                sameSite: 'strict',
                maxAge: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
                path: '/'
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
    } catch (err) {
        logger.error('Erro em /api/auth/login:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

// POST /api/auth/verify - body: { token }
router.post('/verify', validate(authSchemas.verify), async (req, res) => {
    try {
        const token = req.body.token.trim().toUpperCase();

        const now = new Date();
        const record = await EmailVerification.findOne({ where: { Token: token, Used: false } });
        if (!record) return res.status(400).json({ message: 'Token inválido ou já utilizado' });
        if (record.ForcedExpiration) return res.status(400).json({ message: 'Este código foi invalidado porque você solicitou um novo. Use o código mais recente.' });
        if (record.ExpiresAt && new Date(record.ExpiresAt) < now) return res.status(400).json({ message: 'Token expirado' });

        // mark used and set user email confirmed
        record.Used = true;
        await record.save();

        const user = await User.findByPk(record.UserId);
        if (user) {
            user.EmailConfirmado = true;
            user.DataAlteracao = new Date();
            await user.save();
        }

        return res.json({ message: 'E-mail confirmado com sucesso', userId: record.UserId });
    } catch (err) {
        logger.error('Erro em /api/auth/verify:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

// POST /api/auth/forgot-password
// Solicita código de reset de senha
router.post('/forgot-password', resetLimiter, validate(authSchemas.forgotPassword), async (req, res) => {
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
        return res.status(500).json({ message: 'Erro ao processar solicitação' });
    }
});

// POST /api/auth/reset-password
// Reseta senha usando código de verificação
router.post('/reset-password', resetLimiter, validate(authSchemas.resetPassword), async (req, res) => {
    try {
        const { email, token, senhaHash } = req.body;

        const emailLower = email.trim().toLowerCase();
        const tokenUpper = token.trim().toUpperCase();

        // Buscar usuário
        const user = await User.findOne({ where: { Email: emailLower } });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado' });
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
            return res.status(400).json({ message: 'Código inválido. Verifique se digitou corretamente.' });
        }

        // Pegar o mais recente
        const verification = allVerifications[0];

        // Verificar se já foi usado
        if (verification.Used) {
            return res.status(400).json({ message: 'Este código já foi utilizado. Solicite um novo código.' });
        }

        // Verificar se foi forçadamente expirado
        if (verification.ForcedExpiration) {
            return res.status(400).json({ message: 'Este código foi invalidado porque você solicitou um novo. Use o código mais recente.' });
        }

        // Verificar se código expirou naturalmente
        if (new Date() > new Date(verification.ExpiresAt)) {
            return res.status(400).json({ message: 'Código expirado. Solicite um novo código.' });
        }

        // Verificar se o código é realmente para reset de senha
        try {
            const meta = verification.Meta ? JSON.parse(verification.Meta) : {};
            if (meta.type !== 'password_reset') {
                return res.status(400).json({ message: 'Este código não é válido para recuperação de senha.' });
            }
        } catch (_) {
            // Se não tem meta, considerar inválido para reset
            return res.status(400).json({ message: 'Este código não é válido para recuperação de senha.' });
        }

        // Hash da senha com bcrypt (servidor)
        const hashedPassword = await bcrypt.hash(senhaHash, BCRYPT_ROUNDS);

        // Atualizar senha do usuário
        await user.update({ SenhaHash: hashedPassword });

        // Marcar código como usado
        await verification.update({ Used: true });

        // Log successful password reset
        security.passwordResetSuccess(req, emailLower);

        return res.json({ message: 'Senha alterada com sucesso' });
    } catch (err) {
        logger.error('Erro em /api/auth/reset-password:', err);
        return res.status(500).json({ message: 'Erro ao resetar senha' });
    }
});

module.exports = router;

// GET /api/auth/me - resolve user by cookie sessionToken, X-Session-Token header or query parameter
router.get('/me', async (req, res) => {
    try {
        // Read token from cookie (preferred), header, or query parameter (legacy)
        const sessionToken = (req.cookies.sessionToken || req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ message: 'Session token required' });

        let user = null;
        // If token looks like JWT, try to decode
        if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(sessionToken)) {
            try {
                const decoded = jwt.verify(sessionToken, jwtSecret);
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
        if (!user && /^\d+$/.test(sessionToken)) {
            user = await User.findByPk(Number(sessionToken));
        }
        // Legacy: try by username or email
        if (!user) {
            const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
            user = await User.findOne({ where });
        }

        if (!user) return res.status(404).json({ message: 'User not found' });

        return res.json({
            Id: user.Id,
            NomeUsuario: user.NomeUsuario,
            Nome: user.Nome,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado
        });
    } catch (err) {
        logger.error('Erro em /api/auth/me:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

// POST /api/auth/logout - Clear httpOnly cookie and cleanup session
router.post('/logout', (req, res) => {
    try {
        // Clear the httpOnly cookie
        res.clearCookie('sessionToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
        
        return res.json({ 
            success: true, 
            message: 'Logout realizado com sucesso' 
        });
    } catch (err) {
        logger.error('Erro em /api/auth/logout:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});
