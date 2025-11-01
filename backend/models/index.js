const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false,
});

const db = {};

// Import models
db.User = require('./User')(sequelize, DataTypes);
db.EmailVerification = require('./EmailVerification')(sequelize, DataTypes);
// New exam-related models
db.ExamType = require('./ExamType')(sequelize, DataTypes);
db.ExamAttempt = require('./ExamAttempt')(sequelize, DataTypes);
db.ExamAttemptQuestion = require('./ExamAttemptQuestion')(sequelize, DataTypes);
db.ExamAttemptAnswer = require('./ExamAttemptAnswer')(sequelize, DataTypes);

// Associations
if (db.User && db.EmailVerification) {
  db.EmailVerification.belongsTo(db.User, { foreignKey: 'UserId' });
  db.User.hasMany(db.EmailVerification, { foreignKey: 'UserId' });
}

// Associations for exams
if (db.ExamType && db.ExamAttempt) {
  db.ExamType.hasMany(db.ExamAttempt, { foreignKey: 'ExamTypeId' });
  db.ExamAttempt.belongsTo(db.ExamType, { foreignKey: 'ExamTypeId' });
}
if (db.User && db.ExamAttempt) {
  db.User.hasMany(db.ExamAttempt, { foreignKey: 'UserId' });
  db.ExamAttempt.belongsTo(db.User, { foreignKey: 'UserId' });
}
if (db.ExamAttempt && db.ExamAttemptQuestion) {
  db.ExamAttempt.hasMany(db.ExamAttemptQuestion, { foreignKey: 'AttemptId' });
  db.ExamAttemptQuestion.belongsTo(db.ExamAttempt, { foreignKey: 'AttemptId' });
}
if (db.ExamAttemptQuestion && db.ExamAttemptAnswer) {
  db.ExamAttemptQuestion.hasMany(db.ExamAttemptAnswer, { foreignKey: 'AttemptQuestionId' });
  db.ExamAttemptAnswer.belongsTo(db.ExamAttemptQuestion, { foreignKey: 'AttemptQuestionId' });
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
