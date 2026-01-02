const { Sequelize, DataTypes } = require('sequelize');
const { logger } = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// Load environment variables
try {
  const backendEnv = path.resolve(__dirname, '..', '.env');
  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  let chosen = backendEnv;
  if (!fs.existsSync(backendEnv) && fs.existsSync(rootEnv)) chosen = rootEnv;
  require('dotenv').config({ path: chosen });
} catch(_) { /* silencioso */ }

// Validate required database environment variables
const { validateOnLoad } = require('../config/validateEnv');

try {
  validateOnLoad();
} catch (error) {
  logger.error('❌ Failed to initialize models: Invalid environment configuration');
  logger.error('   Error:', error.message);
  process.exit(1);
}

// Extract database credentials safely
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASSWORD;
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT || 5432;

// Additional safety check
if (!dbName || !dbUser || !dbPass) {
  logger.error('❌ FATAL: Missing required database credentials');
  process.exit(1);
}

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  port: dbPort,
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 20,
    min: 5,
    acquire: 30000,
    idle: 10000
  }
});

const db = {};

// Import models
db.User = require('./User')(sequelize, DataTypes);
db.EmailVerification = require('./EmailVerification')(sequelize, DataTypes);
 db.Notification = require('./Notification')(sequelize, DataTypes);
 db.UserNotification = require('./UserNotification')(sequelize, DataTypes);
// New exam-related models
db.ExamType = require('./ExamType')(sequelize, DataTypes);
db.ExamAttempt = require('./ExamAttempt')(sequelize, DataTypes);
db.ExamAttemptQuestion = require('./ExamAttemptQuestion')(sequelize, DataTypes);
db.ExamAttemptAnswer = require('./ExamAttemptAnswer')(sequelize, DataTypes);
db.QuestionType = require('./QuestionType')(sequelize, DataTypes);
db.Indicator = require('./Indicator')(sequelize, DataTypes);
db.ExamAttemptPurgeLog = require('./ExamAttemptPurgeLog')(sequelize, DataTypes);
db.ExamAttemptUserStats = require('./ExamAttemptUserStats')(sequelize, DataTypes);
// Feedback related models
db.CategoriaFeedback = require('./CategoriaFeedback')(sequelize, DataTypes);
db.Feedback = require('./Feedback')(sequelize, DataTypes);
db.RetornoFeedback = require('./RetornoFeedback')(sequelize, DataTypes);


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

// Associations for notifications
if (db.Notification && db.UserNotification) {
  db.Notification.hasMany(db.UserNotification, { foreignKey: 'notificationId' });
  db.UserNotification.belongsTo(db.Notification, { foreignKey: 'notificationId' });
}
if (db.User && db.UserNotification) {
  db.User.hasMany(db.UserNotification, { foreignKey: 'userId' });
  db.UserNotification.belongsTo(db.User, { foreignKey: 'userId' });
}



db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
