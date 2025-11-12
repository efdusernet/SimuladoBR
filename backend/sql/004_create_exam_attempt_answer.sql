-- PostgreSQL: exam_attempt_answer (answers selected per question)
CREATE TABLE IF NOT EXISTS exam_attempt_answer (
  id BIGSERIAL PRIMARY KEY,
  attempt_question_id BIGINT NOT NULL,
  option_id INT NOT NULL,
  selecionada BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_answer_attempt_question FOREIGN KEY (attempt_question_id) REFERENCES exam_attempt_question(id)
);

CREATE INDEX IF NOT EXISTS idx_answer_attempt_question ON exam_attempt_answer (attempt_question_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_attempt_option ON exam_attempt_answer (attempt_question_id, option_id);
