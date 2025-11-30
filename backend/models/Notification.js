module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoria: { type: DataTypes.ENUM('Promocoes','Avisos','Alertas'), allowNull: false },
    titulo: { type: DataTypes.STRING(200), allowNull: false },
    mensagem: { type: DataTypes.TEXT, allowNull: false },
    targetType: { type: DataTypes.ENUM('all','user'), allowNull: false, defaultValue: 'all' },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true },
    status: { type: DataTypes.ENUM('draft','sent'), allowNull: false, defaultValue: 'draft' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    tableName: 'notification',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });
  return Notification;
};
