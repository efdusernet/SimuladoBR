module.exports = (sequelize, DataTypes) => {
  const ExamAttempt = sequelize.define('ExamAttempt', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    UserId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    ExamTypeId: { type: DataTypes.INTEGER, allowNull: false, field: 'exam_type_id' },
    Modo: { type: DataTypes.TEXT, allowNull: true, field: 'modo' },
    QuantidadeQuestoes: { type: DataTypes.INTEGER, allowNull: true, field: 'quantidade_questoes' },
  ExamMode: { type: DataTypes.TEXT, allowNull: true, field: 'exam_mode' },
    StartedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    FinishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
    Status: { type: DataTypes.TEXT, allowNull: true, field: 'status' },
    Corretas: { type: DataTypes.INTEGER, allowNull: true, field: 'corretas' },
    Total: { type: DataTypes.INTEGER, allowNull: true, field: 'total' },
    ScorePercent: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'score_percent' },
    Aprovado: { type: DataTypes.BOOLEAN, allowNull: true, field: 'aprovado' },
    PauseState: { type: DataTypes.JSONB, allowNull: true, field: 'pause_state' },
    BlueprintSnapshot: { type: DataTypes.JSONB, allowNull: true, field: 'blueprint_snapshot' },
    FiltrosUsados: { type: DataTypes.JSONB, allowNull: true, field: 'filtros_usados' },
    Meta: { type: DataTypes.JSONB, allowNull: true, field: 'meta' },
    LastActivityAt: { type: DataTypes.DATE, allowNull: true, field: 'last_activity_at' },
    StatusReason: { type: DataTypes.TEXT, allowNull: true, field: 'status_reason' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'exam_attempt',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamAttempt;
};
