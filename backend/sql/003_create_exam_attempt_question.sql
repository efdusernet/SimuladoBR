-- PostgreSQL: exam_attempt_question (ordered questions in an attempt)
CREATE TABLE IF NOT EXISTS exam_attempt_question (
  id BIGSERIAL PRIMARY KEY,
  attempt_id BIGINT NOT NULL,
  question_id INT NOT NULL,
  ordem INT NOT NULL,
  tempo_gasto_segundos INT DEFAULT 0,
  correta BOOLEAN,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_attempt_question_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempt(id)
);

CREATE INDEX IF NOT EXISTS idx_attempt_question_attempt ON exam_attempt_question (attempt_id);
CREATE INDEX IF NOT EXISTS idx_attempt_question_question ON exam_attempt_question (question_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_question_order ON exam_attempt_question (attempt_id, ordem);
