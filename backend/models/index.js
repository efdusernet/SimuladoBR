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
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const usingPgBouncer = String(process.env.PGBOUNCER || '').trim().toLowerCase() === 'true' || dbPort === 6432;
const poolMax = toInt(process.env.DB_POOL_MAX, usingPgBouncer ? 10 : 20);
const poolMin = toInt(process.env.DB_POOL_MIN, usingPgBouncer ? 0 : 5);
const poolAcquireMs = toInt(process.env.DB_POOL_ACQUIRE_MS, 30_000);
const poolIdleMs = toInt(process.env.DB_POOL_IDLE_MS, 10_000);

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
    max: poolMax,
    min: poolMin,
    acquire: poolAcquireMs,
    idle: poolIdleMs,
  },
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  },
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

// Admin communications recipients
db.CommunicationRecipient = require('./CommunicationRecipient')(sequelize, DataTypes);

// Single active session per user
db.UserActiveSession = require('./UserActiveSession')(sequelize, DataTypes);

// Password change audit log
db.UserPasswordChangeLog = require('./UserPasswordChangeLog')(sequelize, DataTypes);


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

// Associations for communication recipients
if (db.User && db.CommunicationRecipient) {
  db.User.hasMany(db.CommunicationRecipient, { foreignKey: 'UserId' });
  db.CommunicationRecipient.belongsTo(db.User, { foreignKey: 'UserId' });
}

// Associations for user active session
if (db.User && db.UserActiveSession) {
  db.User.hasOne(db.UserActiveSession, { foreignKey: 'UserId' });
  db.UserActiveSession.belongsTo(db.User, { foreignKey: 'UserId' });
}

// Associations for password change audit log
if (db.User && db.UserPasswordChangeLog) {
  db.UserPasswordChangeLog.belongsTo(db.User, { foreignKey: 'TargetUserId', as: 'TargetUser' });
  db.UserPasswordChangeLog.belongsTo(db.User, { foreignKey: 'ActorUserId', as: 'ActorUser' });
}



db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
