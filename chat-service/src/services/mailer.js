const nodemailer = require('nodemailer');

const { env } = require('../config/env');

function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
}

function createTransport() {
  const secure = Number(env.SMTP_PORT) === 465;

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    tls: env.SMTP_ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : undefined,
  });
}

async function sendInviteEmail({ to, role, token, apiBase = '' }) {
  if (!isSmtpConfigured()) {
    const e = new Error('SMTP not configured');
    e.code = 'SMTP_NOT_CONFIGURED';
    throw e;
  }

  const transport = createTransport();

  const safeRole = role === 'admin' ? 'Admin' : 'Atendente';
  const apiBaseHint = apiBase ? `\nAPI Base sugerida (se precisar configurar no painel): ${apiBase}` : '';

  const subject = `Convite de acesso — Painel do Chat (${safeRole})`;
  const text =
    `Olá!\n\n` +
    `Você foi convidada para acessar o Painel do Chat como ${safeRole}.\n\n` +
    `Acesse o painel:\n` +
    `- /admin (no mesmo servidor do chat)\n\n` +
    `Seu token de acesso (guarde em segredo):\n` +
    `${token}\n\n` +
    `Como entrar:\n` +
    `1) Abra o painel\n` +
    `2) Cole o token no campo de autenticação\n` +
    `3) Clique em “Entrar”\n` +
    apiBaseHint +
    `\n\nImportante:\n` +
    `- Não compartilhe este token com ninguém.\n` +
    `- Se você não solicitou este acesso, ignore este e-mail e avise a equipe.`;

  const info = await transport.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
  });

  return { messageId: info && info.messageId ? String(info.messageId) : null };
}

module.exports = {
  isSmtpConfigured,
  sendInviteEmail,
};
