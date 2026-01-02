module.exports = (sequelize, DataTypes) => {
  const ExamType = sequelize.define('ExamType', {
    Id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'id' },
    Slug: { type: DataTypes.TEXT, allowNull: false, unique: true, field: 'slug' },
    Nome: { type: DataTypes.TEXT, allowNull: false, field: 'nome' },
    NumeroQuestoes: { type: DataTypes.INTEGER, allowNull: false, field: 'numero_questoes' },
    DuracaoMinutos: { type: DataTypes.INTEGER, allowNull: false, field: 'duracao_minutos' },
    OpcoesPorQuestao: { type: DataTypes.INTEGER, allowNull: false, field: 'opcoes_por_questao' },
    MultiplaSelecao: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'multipla_selecao' },
    PontuacaoMinimaPercent: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'pontuacao_minima_percent' },
    PausaPermitida: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'pausa_permitida' },
    PausaDuracaoMinutos: { type: DataTypes.INTEGER, allowNull: true, field: 'pausa_duracao_minutos' },
    PausaCheckpoints: { type: DataTypes.JSONB, allowNull: true, field: 'pausa_checkpoints' },
    ScoringPolicy: { type: DataTypes.JSONB, allowNull: true, field: 'scoring_policy' },
    Config: { type: DataTypes.JSONB, allowNull: true, field: 'config' },
    Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'ativo' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'exam_type',
    freezeTableName: true,
    timestamps: false,
  });
  return ExamType;
};
