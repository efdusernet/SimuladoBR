module.exports = (sequelize, DataTypes) => {
  const ExamAttemptAnswer = sequelize.define('ExamAttemptAnswer', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    AttemptQuestionId: { type: DataTypes.BIGINT, allowNull: false, field: 'attempt_question_id' },
    OptionId: { type: DataTypes.INTEGER, allowNull: false, field: 'option_id' },
    Selecionada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'selecionada' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'exam_attempt_answer',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamAttemptAnswer;
};
