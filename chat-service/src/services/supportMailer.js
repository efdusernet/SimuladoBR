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

async function sendSupportContactEmail({ to, adminName, userName, timeHHMMSS }) {
  if (!isSmtpConfigured()) {
    const e = new Error('SMTP not configured');
    e.code = 'SMTP_NOT_CONFIGURED';
    throw e;
  }

  const transport = createTransport();

  const safeAdmin = String(adminName || 'Admin').trim() || 'Admin';
  const safeUser = String(userName || 'Usuário').trim() || 'Usuário';
  const safeTime = String(timeHHMMSS || '').trim() || '??:??:??';

  const subject = 'SimuladosBR — Solicitação de Suporte';
  const text =
    `Olá ${safeAdmin}. Existe uma tentativa de contato com você. ` +
    `O usuário ${safeUser} (quem iniciou o chat) enviou uma mensagem as ${safeTime} solicitando sua ajuda.`;

  const info = await transport.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
  });

  return { messageId: info && info.messageId ? String(info.messageId) : null };
}

module.exports = { sendSupportContactEmail };
