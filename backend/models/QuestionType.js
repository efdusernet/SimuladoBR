module.exports = (sequelize, DataTypes) => {
  const QuestionType = sequelize.define('QuestionType', {
    Slug: { type: DataTypes.STRING, primaryKey: true, field: 'slug' },
    Nome: { type: DataTypes.STRING, allowNull: false, field: 'nome' },
    Version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'version' },
    UiSchema: { type: DataTypes.JSONB, allowNull: true, field: 'ui_schema' },
    DataSchema: { type: DataTypes.JSONB, allowNull: true, field: 'data_schema' },
    GradingSpec: { type: DataTypes.JSONB, allowNull: true, field: 'grading_spec' },
    Flags: { type: DataTypes.JSONB, allowNull: true, field: 'flags' },
    Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'ativo' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'question_type',
    freezeTableName: true,
    timestamps: false,
  });
  return QuestionType;
};
