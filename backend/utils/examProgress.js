// Utility functions to compute attempt progress (responded count and percent)
// Uses scorable questions (excludes pretest) for percentage denominator.

async function computeAttemptProgress(db, attemptId) {
  if (!db || !db.sequelize || !attemptId) return { respondedCount: 0, scorableCount: 0, respondedPercent: 0 };
  const sequelize = db.sequelize;
  try {
    // Fetch scorable question IDs (exclude pretest)
    const qRows = await sequelize.query(
      'SELECT "Id", "QuestionId", "IsPreTest" FROM exam_attempt_question WHERE "AttemptId" = :aid',
      { replacements: { aid: attemptId }, type: sequelize.QueryTypes.SELECT }
    );
    const scorableQids = qRows.filter(r => !r.IsPreTest).map(r => Number(r.QuestionId));
    const scorableSet = new Set(scorableQids);

    let respondedCount = 0;
    if (scorableSet.size) {
      // Distinct questions with at least one selected option or typed response
      const ansRows = await sequelize.query(
        'SELECT DISTINCT aq."QuestionId" AS qid\n         FROM exam_attempt_answer aa\n         JOIN exam_attempt_question aq ON aq."Id" = aa."AttemptQuestionId"\n         WHERE aq."AttemptId" = :aid AND (aa."Selecionada" = TRUE OR aa."Resposta" IS NOT NULL)',
        { replacements: { aid: attemptId }, type: sequelize.QueryTypes.SELECT }
      );
      respondedCount = ansRows.map(r => Number(r.qid)).filter(q => scorableSet.has(q)).length;
    }
    const scorableCount = scorableSet.size;
    const respondedPercent = scorableCount > 0 ? (respondedCount * 100.0) / scorableCount : 0;
    return { respondedCount, scorableCount, respondedPercent };
  } catch (e) {
    return { respondedCount: 0, scorableCount: 0, respondedPercent: 0, error: e };
  }
}

module.exports = { computeAttemptProgress };
