module.exports = (sequelize, DataTypes) => {
  // Definimos explicitamente as colunas para evitar ambiguidade de nomes (tudo minúsculo no DB).
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoria: { type: DataTypes.ENUM('Promocoes','Avisos','Alertas'), allowNull: false, field: 'categoria' },
    titulo: { type: DataTypes.STRING(200), allowNull: false, field: 'titulo' },
    mensagem: { type: DataTypes.TEXT, allowNull: false, field: 'mensagem' },
    targetType: { type: DataTypes.ENUM('all','user'), allowNull: false, defaultValue: 'all', field: 'targettype' },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'targetuserid' },
    status: { type: DataTypes.ENUM('draft','sent'), allowNull: false, defaultValue: 'draft', field: 'status' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'createdby' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'createdat' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updatedat' }
  }, {
    tableName: 'notification',
    timestamps: false // timestamps já mapeados manualmente
  });
  return Notification;
};
