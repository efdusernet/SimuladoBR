/*
  cleanupNonMasterdata.js

  Objective:
  - List and truncate (RESTART IDENTITY, CASCADE) all non-masterdata tables.
  - Designed for dev/test resets; DO NOT run in production without explicit enablement.

  Usage (CLI):
    node backend/scripts/cleanupNonMasterdata.js --dry-run
    node backend/scripts/cleanupNonMasterdata.js --execute --confirm LIMPAR_NAO_MASTERDATA

  Options (CLI):
    --keep-users=1|0 (default 1)
    --keep-rbac=1|0 (default 1)
    --keep-entitlements=1|0 (default 1)
    --keep-notifications=1|0 (default 0)
    --keep-communication=1|0 (default 1)
*/

const db = require('../models');

function quoteIdent(name) {
  const s = String(name);
  return '"' + s.replace(/"/g, '""') + '"';
}

function toBool(v, def) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n') return false;
  return def;
}

// Master/Transactional classification provided by the user.
// M = masterdata/content (must NOT be cleared)
// T = transactional (may be cleared)
function getClassificationSets() {
  const master = new Set([
    'CategoriaFeedback',
    'Dicionario',
    'ECO',
    'Tasks',
    'areaconhecimento',
    'abordagem',
    'dominio_desempenho',
    'dominiogeral',
    'exam_content_current_version',
    'exam_content_version',
    'exam_type',
    'exams',
    'explicacaoguia',
    'grupoprocesso',
    'indicator',
    'niveldificuldade',
    'oauth_account',
    'permission',
    'principios',
    'questao',
    'question_type',
    'respostaopcao',
    'role',
    'statusquestao',
    'user_role',

    // Sequelize internal (keep by default)
    'SequelizeMeta',
  ]);

  const transactional = new Set([
    'EmailVerification',
    'ExamePMPRealizado',
    'ExamePMPRealizadoDetalhe',
    'Feedback',
    'RetornoFeedback',
    'Usuario',
    'communication_recipient',
    'examSession',
    'exam_attempt',
    'exam_attempt_answer',
    'exam_attempt_purge_log',
    'exam_attempt_question',
    'exam_attempt_user_stats',
    'exame_instancia',
    'intervalos',
    'notification',
    'response_times',
    'respostas_aluno',
    'role_permission',
    'user_active_session',
    'user_daily_snapshot',
    'user_exam_content_version',
    'user_notification',
  ]);

  return { master, transactional };
}

function getDefaultKeepTables(opts, allTables) {
  const { master, transactional } = getClassificationSets();
  const keep = new Set(master);

  // Optional: user can extend masterdata list.
  if (opts && Array.isArray(opts.masterdataExtra)) {
    for (const t of opts.masterdataExtra) {
      if (t) keep.add(String(t));
    }
  }

  // Keep toggles (admin UI) override transactional classification.
  if (opts && opts.keepRbac) {
    keep.add('role');
    keep.add('permission');
    keep.add('user_role');
    keep.add('role_permission');
  }

  if (opts && opts.keepEntitlements) {
    // Keep purchase/entitlement related data if present.
    keep.add('payments');
    keep.add('payment');
    keep.add('Payment');
    keep.add('user_exam_content_version');
  }

  if (opts && opts.keepCommunication) {
    keep.add('communication_recipient');
  }

  if (opts && opts.keepNotifications) {
    keep.add('notification');
    keep.add('user_notification');
  }

  // Special case: Usuario should never be TRUNCATEd (we may DELETE rows instead).
  // When keepUsers=true, we keep all rows. When keepUsers=false, we delete all except admin id=21.
  keep.add('Usuario');
  if (opts && opts.keepUsers) {
    keep.add('EmailVerification');
    keep.add('user_active_session');
  }

  // Safety: keep any unclassified tables by default (avoid accidental data loss).
  const keepUnclassified = opts && typeof opts.keepUnclassified === 'boolean' ? opts.keepUnclassified : true;
  const unclassified = [];
  if (keepUnclassified && Array.isArray(allTables)) {
    for (const t of allTables) {
      if (!t) continue;
      if (master.has(t) || transactional.has(t) || keep.has(t)) continue;
      unclassified.push(t);
      keep.add(t);
    }
  }

  return { keepSet: keep, unclassified };
}

async function listPublicTables(sequelize) {
  const rows = await sequelize.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC
    `,
    { type: db.Sequelize.QueryTypes.SELECT }
  );
  return (rows || []).map(r => r.tablename).filter(Boolean);
}

function computePlan(allTables, keepSet) {
  const keep = [];
  const truncate = [];

  for (const t of allTables) {
    if (keepSet.has(t)) keep.push(t);
    else truncate.push(t);
  }

  return {
    keep,
    truncate,
  };
}

async function truncateTables(sequelize, tables, transaction) {
  const list = Array.isArray(tables) ? tables.filter(Boolean) : [];
  if (!list.length) return { truncated: 0 };

  // TRUNCATE with CASCADE handles FK dependencies; RESTART IDENTITY resets sequences.
  const qualified = list.map(t => 'public.' + quoteIdent(t));
  const sql = `TRUNCATE TABLE ${qualified.join(', ')} RESTART IDENTITY CASCADE;`;
  await sequelize.query(sql, { transaction });
  return { truncated: list.length };
}

async function deleteUsersExceptAdmin(sequelize, { adminId = 21 } = {}, transaction) {
  // Usuario is transactional, but must preserve the admin row.
  // We intentionally do NOT reset sequences here.
  const sql = `DELETE FROM public.${quoteIdent('Usuario')} WHERE id <> :adminId;`;
  const [res] = await sequelize.query(sql, { replacements: { adminId }, transaction });
  // res varies by dialect/driver; return a best-effort hint.
  return { action: 'delete', table: 'Usuario', preserveUserId: adminId, result: res || null };
}

async function cleanupNonMasterdata({
  dryRun = true,
  confirm = null,
  keepUsers = true,
  keepRbac = true,
  keepEntitlements = true,
  keepNotifications = false,
  keepCommunication = true,
  masterdataExtra = [],
  keepUnclassified = true,
  userAdminIdPreserve = 21,
} = {}) {
  const sequelize = db.sequelize;

  const allTables = await listPublicTables(sequelize);
  const { keepSet, unclassified } = getDefaultKeepTables(
    {
      keepUsers,
      keepRbac,
      keepEntitlements,
      keepNotifications,
      keepCommunication,
      masterdataExtra,
      keepUnclassified,
    },
    allTables
  );

  const plan = computePlan(allTables, keepSet);

  // Ensure Usuario is never truncated.
  plan.truncate = plan.truncate.filter(t => t !== 'Usuario');

  const specialActions = [];
  if (!keepUsers) {
    specialActions.push({
      table: 'Usuario',
      action: `DELETE WHERE id <> ${Number(userAdminIdPreserve) || 21}`,
    });
  }

  if (dryRun) {
    return {
      dryRun: true,
      totalTables: allTables.length,
      unclassified,
      keep: plan.keep,
      truncate: plan.truncate,
      specialActions,
    };
  }

  if (String(confirm || '') !== 'LIMPAR_NAO_MASTERDATA') {
    const err = new Error('Confirmação inválida. Use confirm=LIMPAR_NAO_MASTERDATA.');
    err.code = 'CONFIRMATION_REQUIRED';
    throw err;
  }

  const res = await sequelize.transaction(async (t) => {
    const trunc = await truncateTables(sequelize, plan.truncate, t);
    let userCleanup = null;
    if (!keepUsers) {
      userCleanup = await deleteUsersExceptAdmin(
        sequelize,
        { adminId: Number(userAdminIdPreserve) || 21 },
        t
      );
    }
    return { trunc, userCleanup };
  });

  return {
    dryRun: false,
    totalTables: allTables.length,
    unclassified,
    kept: plan.keep.length,
    truncated: res.trunc.truncated,
    keep: plan.keep,
    truncate: plan.truncate,
    specialActions,
    userCleanup: res.userCleanup,
  };
}

module.exports = {
  cleanupNonMasterdata,
  listPublicTables,
  getDefaultKeepTables,
  getClassificationSets,
};

// CLI runner
if (require.main === module) {
  (async () => {
    try {
      const argv = process.argv.slice(2);
      const arg = (name) => {
        const idx = argv.findIndex(a => a === name || a.startsWith(name + '='));
        if (idx < 0) return null;
        const tok = argv[idx];
        if (tok.includes('=')) return tok.split('=').slice(1).join('=');
        return argv[idx + 1] || '';
      };

      const dryRun = argv.includes('--dry-run') || !argv.includes('--execute');
      const confirm = arg('--confirm');

      const keepUsers = toBool(arg('--keep-users'), true);
      const keepRbac = toBool(arg('--keep-rbac'), true);
      const keepEntitlements = toBool(arg('--keep-entitlements'), true);
      const keepNotifications = toBool(arg('--keep-notifications'), false);
      const keepCommunication = toBool(arg('--keep-communication'), true);
      const keepUnclassified = toBool(arg('--keep-unclassified'), true);
      const userAdminIdPreserve = Number(arg('--preserve-user-id')) || 21;

      const result = await cleanupNonMasterdata({
        dryRun,
        confirm,
        keepUsers,
        keepRbac,
        keepEntitlements,
        keepNotifications,
        keepCommunication,
        keepUnclassified,
        userAdminIdPreserve,
      });

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e && e.message ? e.message : e);
      process.exit(1);
    }
  })();
}
