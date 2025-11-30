module.exports = (sequelize, DataTypes) => {
  const CategoriaFeedback = sequelize.define('CategoriaFeedback', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    texto: { type: DataTypes.STRING(255), allowNull: false },
  }, {
    tableName: 'CategoriaFeedback',
    freezeTableName: true,
    timestamps: false,
  });
  return CategoriaFeedback;
};
