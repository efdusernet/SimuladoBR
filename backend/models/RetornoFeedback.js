module.exports = (sequelize, DataTypes) => {
  const RetornoFeedback = sequelize.define('RetornoFeedback', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idquestao: { type: DataTypes.INTEGER, allowNull: false },
    resposta: { type: DataTypes.TEXT, allowNull: false },
    data: { type: DataTypes.TIME, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    idusuariorespondeu: { type: DataTypes.INTEGER, allowNull: false },
    idfeedback: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    tableName: 'RetornoFeedback',
    freezeTableName: true,
    timestamps: false,
  });
  return RetornoFeedback;
};
