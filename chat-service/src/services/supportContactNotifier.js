const { isSmtpConfigured } = require('./mailer');
const { sendSupportContactEmail } = require('./supportMailer');
const { communicationQuery, getCommunicationDbInfo } = require('../db/communicationPool');

function normalizeTitle(s) {
  return String(s || '').trim().toLowerCase();
}

function safeName(row) {
  const nome = row && row.nome ? String(row.nome).trim() : '';
  if (nome) return nome;
  const nomeUsuario = row && row.nome_usuario ? String(row.nome_usuario).trim() : '';
  if (nomeUsuario) return nomeUsuario;
  const email = row && row.email ? String(row.email).trim() : '';
  if (email) return email;
  return 'Admin';
}

async function listCommunicationRecipients() {
  try {
    const r = await communicationQuery(
      'SELECT cr.user_id, u."Nome" AS nome, u."NomeUsuario" AS nome_usuario, u."Email" AS email\n' +
        'FROM public.communication_recipient cr\n' +
        'JOIN "Usuario" u ON u."Id" = cr.user_id\n' +
        'WHERE cr.active = TRUE\n' +
        'ORDER BY COALESCE(u."Nome", \'\') ASC, u."Id" ASC'
    );
    return Array.isArray(r.rows) ? r.rows : [];
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    const msg = e && e.message ? String(e.message) : '';
    const missing = code === '42P01' || /relation .* does not exist/i.test(msg);
    if (missing) {
      try {
        const info = getCommunicationDbInfo();
        const where = [info.host, info.database].filter(Boolean).join('/');
        const suffix = where ? ` (db=${where})` : '';
        console.warn(
          `[supportContactNotifier] communication tables missing; skipping emails (using ${info.source}${suffix}). ` +
          `Fix: point COMMUNICATION_DATABASE_URL to the SimuladosBR DB (where public.communication_recipient + Usuario exist) and ensure SQL migration 043_create_communication_recipient.sql was applied.`
        );
      } catch (_) {
        try { console.warn('[supportContactNotifier] communication tables missing; skipping emails'); } catch (_) {}
      }
      return [];
    }
    throw e;
  }
}

function formatTimeHHMMSS(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    // pt-BR uses HH:MM:SS by default when hour12=false.
    return d.toLocaleTimeString('pt-BR', { hour12: false });
  } catch (_) {
    return '';
  }
}

async function notifySupportContact({ supportTopicTitle, userName, messageCreatedAt }) {
  // Guard: only send for the explicit topic.
  if (normalizeTitle(supportTopicTitle) !== normalizeTitle('Falar com Suporte')) return { ok: false, skipped: true };

  if (!isSmtpConfigured()) {
    return { ok: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };
  }

  const recipients = await listCommunicationRecipients();
  const valid = recipients.filter(r => r && r.email && String(r.email).includes('@'));
  if (!valid.length) {
    return { ok: false, skipped: true, reason: 'NO_RECIPIENTS' };
  }

  const nomeUsuario = String(userName || '').trim() || 'Usuário';
  const hora = formatTimeHHMMSS(messageCreatedAt) || formatTimeHHMMSS(new Date()) || '';

  const results = [];
  for (const r of valid) {
    const adminName = safeName(r);
    const to = String(r.email).trim();
    try {
      const sent = await sendSupportContactEmail({
        to,
        adminName,
        userName: nomeUsuario,
        timeHHMMSS: hora,
      });
      results.push({ to, ok: true, messageId: sent && sent.messageId ? sent.messageId : null });
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      const msg = e && e.message ? String(e.message) : 'EMAIL_SEND_FAILED';
      results.push({ to, ok: false, error: code || msg });
    }
  }

  return { ok: true, sent: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, results };
}

module.exports = { notifySupportContact };
