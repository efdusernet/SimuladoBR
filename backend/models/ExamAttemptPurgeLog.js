module.exports = (sequelize, DataTypes) => {
  const ExamAttemptPurgeLog = sequelize.define('ExamAttemptPurgeLog', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    AttemptId: { type: DataTypes.BIGINT, allowNull: false, field: 'attempt_id' },
    UserId: { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
    ExamTypeId: { type: DataTypes.INTEGER, allowNull: true, field: 'exam_type_id' },
    ExamMode: { type: DataTypes.TEXT, allowNull: true, field: 'exam_mode' },
    QuantidadeQuestoes: { type: DataTypes.INTEGER, allowNull: true, field: 'quantidade_questoes' },
    RespondedCount: { type: DataTypes.INTEGER, allowNull: true, field: 'responded_count' },
    RespondedPercent: { type: DataTypes.DECIMAL(6,3), allowNull: true, field: 'responded_percent' },
    StatusBefore: { type: DataTypes.TEXT, allowNull: true, field: 'status_before' },
    StatusReasonBefore: { type: DataTypes.TEXT, allowNull: true, field: 'status_reason_before' },
    StartedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    FinishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
    PurgeReason: { type: DataTypes.TEXT, allowNull: true, field: 'purge_reason' },
    PurgedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'purged_at' },
    Meta: { type: DataTypes.JSONB, allowNull: true, field: 'meta' },
  }, {
    tableName: 'exam_attempt_purge_log',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamAttemptPurgeLog;
};