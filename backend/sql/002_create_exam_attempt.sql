-- PostgreSQL: exam_attempt (user attempts/sessions)
CREATE TABLE IF NOT EXISTS exam_attempt (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  exam_type_id INT NOT NULL,
  modo TEXT,
  quantidade_questoes INT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT,
  corretas INT,
  total INT,
  score_percent NUMERIC(5,2),
  aprovado BOOLEAN,
  pause_state JSONB,
  blueprint_snapshot JSONB,
  filtros_usados JSONB,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_exam_attempt_user FOREIGN KEY (user_id) REFERENCES "Usuario"("Id"),
  CONSTRAINT fk_exam_attempt_type FOREIGN KEY (exam_type_id) REFERENCES exam_type(id)
);

CREATE INDEX IF NOT EXISTS idx_attempt_user ON exam_attempt (user_id);
CREATE INDEX IF NOT EXISTS idx_attempt_type ON exam_attempt (exam_type_id);
CREATE INDEX IF NOT EXISTS idx_attempt_started ON exam_attempt (started_at DESC);
