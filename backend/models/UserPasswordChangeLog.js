module.exports = (sequelize, DataTypes) => {
  const UserPasswordChangeLog = sequelize.define('UserPasswordChangeLog', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    TargetUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'target_user_id' },
    ActorUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'actor_user_id' },
    Origin: { type: DataTypes.TEXT, allowNull: true, field: 'origin' },
    Ip: { type: DataTypes.TEXT, allowNull: true, field: 'ip' },
    UserAgent: { type: DataTypes.TEXT, allowNull: true, field: 'user_agent' },
    ChangedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'changed_at' }
  }, {
    tableName: 'user_password_change_log',
    freezeTableName: true,
    timestamps: false
  });

  return UserPasswordChangeLog;
};
