const nodemailer = require('nodemailer');
require('dotenv').config();

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Enable logger/debug when SMTP is configured to help diagnose issues
  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465, // true for 465, false for other ports
    // TLS strictness: allow opt-out for local/debug environments using SMTP_ALLOW_SELF_SIGNED=true
    tls: {
      rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED === 'true' ? false : true
    },
    auth: user && pass ? { user, pass } : undefined,
    logger: true,
    debug: true
  });
  return transporter;
};

async function sendVerificationEmail(toEmail, token) {
  const transporter = createTransporter();
  const appBase = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const verifyUrl = `${appBase.replace(/\/$/, '')}/api/auth/verify?token=${encodeURIComponent(token)}`;

  const subject = 'Verificação de e-mail — SimuladosBR';
  const text = `Seu código de verificação: ${token}\nUse este link para validar: ${verifyUrl}`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height:1.4; color:#111;">
      <p>Olá,</p>
      <p>Use o código de verificação abaixo para confirmar seu e-mail no SimuladosBR:</p>
      <p style="font-size:20px; font-weight:700; letter-spacing:2px; margin:16px 0;">${token}</p>
      <p>Caso prefira, clique no link para validar automaticamente:</p>
      <p><a href="${verifyUrl}" style="color:#1a73e8;">${verifyUrl}</a></p>
      <hr style="border:none; border-top:1px solid #eee; margin:18px 0;" />
      <p style="font-size:12px; color:#666;">Se você não solicitou este e-mail, ignore-o.</p>
    </div>`;

  if (!transporter) {
    // Fallback for dev: log the token and URL so developer can copy it
    console.log('[mailer] SMTP não configurado. Token de verificação: ', token);
    console.log('[mailer] URL de verificação: ', verifyUrl);
    return { ok: true, debug: true, token, verifyUrl };
  }

  const from = process.env.EMAIL_FROM || `no-reply@${process.env.APP_HOST || 'localhost'}`;

  // Verify transporter configuration/connectivity early — nodemailer may throw if connection/auth fails
  let verifyError = null;
  try {
    await transporter.verify();
  } catch (vErr) {
    verifyError = vErr;
    console.error('[mailer] transporter.verify() failed:', vErr);
    // If the failure is due to a self-signed certificate and the env allows it, continue and attempt sendMail.
    const allowSelf = process.env.SMTP_ALLOW_SELF_SIGNED === 'true';
    const msg = String(vErr || '');
    if (allowSelf && /self-signed certificate/i.test(msg)) {
      console.warn('[mailer] transporter.verify() failed with self-signed certificate, but SMTP_ALLOW_SELF_SIGNED=true — attempting sendMail anyway.');
      // continue to sendMail
    } else {
      // return verify error to caller
      return { ok: false, error: String(vErr) };
    }
  }

  try {
    const info = await transporter.sendMail({ from, to: toEmail, subject, text, html });
    // include verifyError if present (so caller can know verify failed but send may have succeeded)
    return verifyError ? { ok: true, info, verifyError: String(verifyError) } : { ok: true, info };
  } catch (sendErr) {
    console.error('[mailer] sendMail failed:', sendErr);
    // prefer to surface send error, but include verifyError if any
    return verifyError ? { ok: false, error: String(sendErr), verifyError: String(verifyError) } : { ok: false, error: String(sendErr) };
  }
}

module.exports = { sendVerificationEmail };
