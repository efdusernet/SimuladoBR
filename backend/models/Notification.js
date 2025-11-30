module.exports = (sequelize, DataTypes) => {
  // As colunas foram criadas sem aspas (SQL manual), então Postgres converteu para minúsculas.
  // Mapeamos os atributos camelCase para os nomes reais em minúsculo (targettype, targetuserid, createdby, createdat, updatedat).
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoria: { type: DataTypes.ENUM('Promocoes','Avisos','Alertas'), allowNull: false },
    titulo: { type: DataTypes.STRING(200), allowNull: false },
    mensagem: { type: DataTypes.TEXT, allowNull: false },
    targetType: { type: DataTypes.ENUM('all','user'), allowNull: false, defaultValue: 'all', field: 'targettype' },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'targetuserid' },
    status: { type: DataTypes.ENUM('draft','sent'), allowNull: false, defaultValue: 'draft' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'createdby' }
  }, {
    tableName: 'notification',
    timestamps: true,
    createdAt: 'createdat',
    updatedAt: 'updatedat'
  });
  return Notification;
};
