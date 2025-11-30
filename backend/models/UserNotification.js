module.exports = (sequelize, DataTypes) => {
  const UserNotification = sequelize.define('UserNotification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    notificationId: { type: DataTypes.INTEGER, allowNull: false, field: 'notificationid' },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'userid' },
    deliveryStatus: { type: DataTypes.ENUM('queued','delivered'), allowNull: false, defaultValue: 'queued', field: 'deliverystatus' },
    deliveredAt: { type: DataTypes.DATE, allowNull: true, field: 'deliveredat' },
    readAt: { type: DataTypes.DATE, allowNull: true, field: 'readat' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'createdat' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updatedat' }
  }, {
    tableName: 'user_notification',
    timestamps: false,
    indexes: [{ fields: ['userid','readat'] }, { fields: ['notificationid'] }]
  });
  return UserNotification;
};
