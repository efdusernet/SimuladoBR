module.exports = (sequelize, DataTypes) => {
  const ExamAttemptQuestion = sequelize.define('ExamAttemptQuestion', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    AttemptId: { type: DataTypes.BIGINT, allowNull: false, field: 'attempt_id' },
    QuestionId: { type: DataTypes.INTEGER, allowNull: false, field: 'question_id' },
    Ordem: { type: DataTypes.INTEGER, allowNull: false, field: 'ordem' },
    TempoGastoSegundos: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'tempo_gasto_segundos' },
    Correta: { type: DataTypes.BOOLEAN, allowNull: true, field: 'correta' },
    Meta: { type: DataTypes.JSONB, allowNull: true, field: 'meta' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'exam_attempt_question',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamAttemptQuestion;
};
