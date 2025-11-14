module.exports = (sequelize, DataTypes) => {
  const Indicator = sequelize.define('Indicator', {
    Id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'id' },
    Nome: { type: DataTypes.TEXT, allowNull: false, field: 'nome' },
    Descricao: { type: DataTypes.TEXT, allowNull: true, field: 'descricao' },
    Pagina: { type: DataTypes.TEXT, allowNull: false, field: 'pagina' },
    ElementoHtml: { type: DataTypes.TEXT, allowNull: false, field: 'elemento_html' },
    FormulaCalculo: { type: DataTypes.TEXT, allowNull: true, field: 'formula_calculo' },
    VersaoExame: { type: DataTypes.TEXT, allowNull: true, field: 'versao_exame' },
    Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'ativo' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'indicator',
    freezeTableName: true,
    timestamps: false,
  });
  return Indicator;
};
