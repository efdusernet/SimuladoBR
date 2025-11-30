module.exports = (sequelize, DataTypes) => {
  const UserNotification = sequelize.define('UserNotification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    notificationId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    deliveryStatus: { type: DataTypes.ENUM('queued','delivered'), allowNull: false, defaultValue: 'queued' },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'user_notification',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [{ fields: ['userId','readAt'] }, { fields: ['notificationId'] }]
  });
  return UserNotification;
};
