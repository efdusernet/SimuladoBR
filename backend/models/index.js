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

// Associations
if (db.User && db.EmailVerification) {
  db.EmailVerification.belongsTo(db.User, { foreignKey: 'UserId' });
  db.User.hasMany(db.EmailVerification, { foreignKey: 'UserId' });
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
