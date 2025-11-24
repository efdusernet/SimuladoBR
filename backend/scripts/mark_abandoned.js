#!/usr/bin/env node
// Script to mark exam attempts as abandoned based on inactivity and low progress thresholds.
// Usage: node backend/scripts/mark_abandoned.js

const db = require('../models');
const policies = require('../config/examPolicies');
const { computeAttemptProgress } = require('../utils/examProgress');

async function run() {
  const now = Date.now();
  let processed = 0;
  let markedTimeout = 0;
  let markedLowProgress = 0;
  const batchLimit = policies.BATCH_LIMIT || 250;

  // Load in-progress attempts limited batch
  const attempts = await db.ExamAttempt.findAll({
    where: { Status: 'in_progress' },
    order: [['StartedAt', 'ASC']],
    limit: batchLimit,
  });

  for (const attempt of attempts) {
    processed++;
    const lastActivity = attempt.LastActivityAt || attempt.StartedAt || new Date();
    const hoursSinceActivity = (now - new Date(lastActivity).getTime()) / 3600000;

    const isFull = String(attempt.ExamMode || '').toLowerCase() === 'full';
    const inactivityLimit = isFull ? policies.INACTIVITY_TIMEOUT_FULL_HOURS : policies.INACTIVITY_TIMEOUT_DEFAULT_HOURS;

    const progress = await computeAttemptProgress(db, attempt.Id);
    const respondedPercent = progress.respondedPercent;

    let reason = null;
    if (hoursSinceActivity >= inactivityLimit) {
      reason = 'timeout_inactivity';
      markedTimeout++;
    } else if (hoursSinceActivity >= policies.ABANDON_THRESHOLD_INACTIVITY_HOURS && respondedPercent < policies.ABANDON_THRESHOLD_PERCENT) {
      reason = 'abandoned_low_progress';
      markedLowProgress++;
    }

    if (reason) {
      await db.ExamAttempt.update({
        Status: 'abandoned',
        StatusReason: reason,
        // Do not set FinishedAt for abandoned; keep possible future analytics distinct
      }, { where: { Id: attempt.Id } });
    }
  }

  console.log(JSON.stringify({ processed, markedTimeout, markedLowProgress }, null, 2));
  await db.sequelize.close();
}

run().catch(err => { console.error(err); process.exit(1); });
