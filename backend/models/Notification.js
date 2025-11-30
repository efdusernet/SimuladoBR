module.exports = (sequelize, DataTypes) => {
  // Campos camelCase mapeados para colunas minúsculas criadas via SQL manual.
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoria: { type: DataTypes.ENUM('Promocoes','Avisos','Alertas'), allowNull: false, field: 'categoria' },
    titulo: { type: DataTypes.STRING(200), allowNull: false, field: 'titulo' },
    mensagem: { type: DataTypes.TEXT, allowNull: false, field: 'mensagem' },
    targetType: { type: DataTypes.ENUM('all','user'), allowNull: false, defaultValue: 'all', field: 'targettype' },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'targetuserid' },
    status: { type: DataTypes.ENUM('draft','sent'), allowNull: false, defaultValue: 'draft', field: 'status' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'createdby' }
  }, {
    tableName: 'notification',
    timestamps: true,
    createdAt: 'createdat',
    updatedAt: 'updatedat'
  });
  return Notification;
};
