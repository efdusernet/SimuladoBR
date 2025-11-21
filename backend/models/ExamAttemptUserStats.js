module.exports = (sequelize, DataTypes) => {
  const ExamAttemptUserStats = sequelize.define('ExamAttemptUserStats', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    UserId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    Date: { type: DataTypes.DATEONLY, allowNull: false, field: 'date' },
    StartedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'started_count' },
    FinishedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'finished_count' },
    AbandonedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'abandoned_count' },
    TimeoutCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'timeout_count' },
    LowProgressCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'low_progress_count' },
    PurgedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'purged_count' },
    AvgScorePercent: { type: DataTypes.DECIMAL(6,3), allowNull: true, field: 'avg_score_percent' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'exam_attempt_user_stats',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamAttemptUserStats;
};
