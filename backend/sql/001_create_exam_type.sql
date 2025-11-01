-- PostgreSQL: exam_type (types/blueprints for exams)
CREATE TABLE IF NOT EXISTS exam_type (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  numero_questoes INT NOT NULL,
  duracao_minutos INT NOT NULL,
  opcoes_por_questao INT NOT NULL,
  multipla_selecao BOOLEAN NOT NULL DEFAULT FALSE,
  pontuacao_minima_percent NUMERIC(5,2),
  pausa_permitida BOOLEAN NOT NULL DEFAULT FALSE,
  pausa_duracao_minutos INT,
  pausa_checkpoints JSONB,
  scoring_policy JSONB,
  config JSONB,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep slug fast for reads
CREATE INDEX IF NOT EXISTS idx_exam_type_slug ON exam_type (slug);
