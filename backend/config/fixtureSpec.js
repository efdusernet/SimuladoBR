// Central definitions for fixture attempt generation metadata.
// Increment fixtureVersion when behavior changes (e.g., answer pattern, timing distribution).

module.exports = {
  fixtureVersion: '1.1.0', // 1.0.0 = basic-null answers; 1.1.0 = all correct options selected for correct questions
  answerStrategy: 'all-correct-options', // other potential values: basic-null, sampled-realistic
};
