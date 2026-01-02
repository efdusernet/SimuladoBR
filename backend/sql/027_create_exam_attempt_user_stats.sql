-- 027: Create daily user exam attempt stats aggregation table
-- Purpose: persist per-user daily counts for attempts lifecycle to survive purges.
-- Provides fast lookup for abandonment/completion rates.

CREATE TABLE IF NOT EXISTS exam_attempt_user_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  started_count INTEGER NOT NULL DEFAULT 0,
  finished_count INTEGER NOT NULL DEFAULT 0,
  abandoned_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  low_progress_count INTEGER NOT NULL DEFAULT 0,
  purged_count INTEGER NOT NULL DEFAULT 0,
  avg_score_percent NUMERIC(6,3) NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_exam_attempt_user_stats_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS ix_exam_attempt_user_stats_user_date ON exam_attempt_user_stats (user_id, date);
