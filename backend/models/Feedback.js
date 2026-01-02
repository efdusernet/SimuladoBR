module.exports = (sequelize, DataTypes) => {
  const Feedback = sequelize.define('Feedback', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    texto: { type: DataTypes.TEXT, allowNull: false },
    idcategoria: { type: DataTypes.INTEGER, allowNull: false },
    idquestao: { type: DataTypes.INTEGER, allowNull: false },
    reportadopor: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'Feedback',
    freezeTableName: true,
    timestamps: false,
  });
  return Feedback;
};
