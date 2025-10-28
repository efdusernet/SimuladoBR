const express = require('express');
const router = express.Router();
const db = require('../models');
const { User, EmailVerification } = db;
const Op = db.Sequelize && db.Sequelize.Op;
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendVerificationEmail } = require('../utils/mailer');

// POST /api/auth/login
router.post('/login', async (req, res) => {
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
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

        // If email not confirmed, create/send verification token and ask user to validate
        if (!user.EmailConfirmado) {
            try {
                const token = require('../utils/codegen').generateVerificationCode(6);
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                await EmailVerification.create({ UserId: user.Id, Token: token, ExpiresAt: expiresAt, Used: false, CreatedAt: new Date() });
                await sendVerificationEmail(user.Email, token);
            } catch (e) {
                console.error('Erro criando/enviando token verificação no login:', e);
            }
            return res.status(403).json({ message: 'E-mail não confirmado. Enviamos um token para o seu e-mail.' });
        }

        if (!user.SenhaHash) return res.status(401).json({ message: 'Usuário sem senha cadastrada' });

        const match = await bcrypt.compare(body.SenhaHash, user.SenhaHash);
        if (!match) return res.status(401).json({ message: 'Credenciais inválidas' });

        // Successful login - return minimal user info
        return res.json({
            Id: user.Id,
            NomeUsuario: user.NomeUsuario,
            Nome: user.Nome,
            Email: user.Email,
            EmailConfirmado: user.EmailConfirmado,
            BloqueioAtivado: user.BloqueioAtivado
        });
    } catch (err) {
        console.error('Erro em /api/auth/login:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

// POST /api/auth/verify - body: { token }
router.post('/verify', async (req, res) => {
    try {
        const token = (req.body && req.body.token) || req.query.token;
        if (!token) return res.status(400).json({ message: 'Token obrigatório' });

        const now = new Date();
        const record = await EmailVerification.findOne({ where: { Token: token, Used: false } });
        if (!record) return res.status(400).json({ message: 'Token inválido ou já utilizado' });
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
        console.error('Erro em /api/auth/verify:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});

module.exports = router;

// GET /api/auth/me - resolve user by X-Session-Token header (NomeUsuario or Email or Id)
router.get('/me', async (req, res) => {
    try {
        const sessionToken = (req.get('X-Session-Token') || req.query.sessionToken || '').trim();
        if (!sessionToken) return res.status(400).json({ message: 'X-Session-Token required' });

        let user = null;
        // if numeric, try by Id first
        if (/^\d+$/.test(sessionToken)) {
            user = await User.findByPk(Number(sessionToken));
        }

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
        console.error('Erro em /api/auth/me:', err);
        return res.status(500).json({ message: 'Erro interno' });
    }
});
