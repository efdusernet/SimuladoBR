const { configured, sequelize } = require('../config/marketplaceDatabase');

function fallbackExams() {
  return [
    { examId: 'PMP', title: 'PMP (Clássico)', uiEntry: 'legacy', enabled: true, source: 'fallback' },
  ];
}

function normalizeRow(row) {
  const code = String(row && (row.code || row.exam_code) || '').trim();
  const name = String(row && (row.name || row.exam_name) || '').trim();
  const examId = code || 'PMP';
  const title = name || examId;
  const uiEntry = (examId === 'PMP') ? 'legacy' : 'v2';
  return { examId, title, uiEntry, enabled: true, source: 'marketplace' };
}

async function listAvailableExamsForUser(coreUserId) {
  const uid = Number(coreUserId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, exams: fallbackExams(), error: 'invalid_core_user_id' };
  }

  if (!configured || !sequelize) {
    return { ok: true, exams: fallbackExams(), source: 'fallback', marketplaceConfigured: false };
  }

  try {
    const [rows] = await sequelize.query(
      `
      SELECT ec.code, ec.name
      FROM marketplace.user_exam_access uea
      JOIN marketplace.exam_catalog ec ON ec.exam_id = uea.exam_id
      WHERE uea.core_user_id = :uid
        AND uea.status = TRUE
        AND ec.status = TRUE
        AND (uea.starts_at IS NULL OR uea.starts_at <= now())
        AND (uea.expires_at IS NULL OR uea.expires_at > now())
      ORDER BY ec.code ASC;
      `,
      { replacements: { uid } }
    );

    const exams = Array.isArray(rows) ? rows.map(normalizeRow).filter(x => x && x.examId) : [];

    if (!exams.length) {
      return { ok: true, exams: fallbackExams(), source: 'fallback-empty', marketplaceConfigured: true };
    }

    return { ok: true, exams, source: 'marketplace', marketplaceConfigured: true };
  } catch (e) {
    return { ok: false, exams: fallbackExams(), source: 'fallback-error', marketplaceConfigured: true, error: e && e.message ? String(e.message) : 'marketplace_query_error' };
  }
}

function chooseDefaultExamId(exams) {
  const list = Array.isArray(exams) ? exams : [];
  if (!list.length) return 'PMP';
  const hasPmp = list.find(x => x && x.examId === 'PMP');
  if (hasPmp) return 'PMP';
  return String(list[0].examId || 'PMP');
}

async function grantUserExamAccess({ coreUserId, examId, title, startsAt, expiresAt, status }) {
  const uid = Number(coreUserId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, error: 'invalid_core_user_id' };
  }

  const code = String(examId || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'exam_id_required' };

  if (!configured || !sequelize) {
    return { ok: false, error: 'marketplace_db_not_configured' };
  }

  const examName = String(title || code).trim();
  const isActive = (status === undefined || status === null) ? true : !!status;

  try {
    // Ensure exam exists
    await sequelize.query(
      `
      INSERT INTO marketplace.exam_catalog (code, name, status)
      VALUES (:code, :name, TRUE)
      ON CONFLICT (code) DO NOTHING;
      `,
      { replacements: { code, name: examName } }
    );

    const [examRows] = await sequelize.query(
      `SELECT exam_id FROM marketplace.exam_catalog WHERE code = :code LIMIT 1;`,
      { replacements: { code } }
    );
    const examRow = Array.isArray(examRows) && examRows[0] ? examRows[0] : null;
    if (!examRow || !examRow.exam_id) return { ok: false, error: 'exam_not_found' };

    await sequelize.query(
      `
      INSERT INTO marketplace.user_exam_access (core_user_id, exam_id, status, starts_at, expires_at, updated_at)
      VALUES (:uid, :examId, :status, :startsAt, :expiresAt, now())
      ON CONFLICT (core_user_id, exam_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        starts_at = EXCLUDED.starts_at,
        expires_at = EXCLUDED.expires_at,
        updated_at = now();
      `,
      {
        replacements: {
          uid,
          examId: examRow.exam_id,
          status: isActive,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }
      }
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : 'grant_failed' };
  }
}

module.exports = {
  listAvailableExamsForUser,
  chooseDefaultExamId,
  grantUserExamAccess,
};
