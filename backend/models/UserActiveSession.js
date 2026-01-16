module.exports = (sequelize, DataTypes) => {
  const UserActiveSession = sequelize.define('UserActiveSession', {
    UserId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false, field: 'user_id' },
    SessionId: { type: DataTypes.TEXT, allowNull: false, field: 'session_id' },
    IssuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'issued_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'user_active_session',
    freezeTableName: true,
    timestamps: false,
  });

  return UserActiveSession;
};
