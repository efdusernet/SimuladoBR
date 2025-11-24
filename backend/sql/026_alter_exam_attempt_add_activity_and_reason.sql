-- 026: Add LastActivityAt and StatusReason to exam_attempt; create exam_attempt_purge_log
ALTER TABLE exam_attempt
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS status_reason TEXT NULL;

-- New table to log purged attempts for audit/recovery metrics
CREATE TABLE IF NOT EXISTS exam_attempt_purge_log (
  id BIGSERIAL PRIMARY KEY,
  attempt_id BIGINT NOT NULL,
  user_id INTEGER NULL,
  exam_type_id INTEGER NULL,
  exam_mode TEXT NULL,
  quantidade_questoes INTEGER NULL,
  responded_count INTEGER NULL,
  responded_percent NUMERIC(6,3) NULL,
  status_before TEXT NULL,
  status_reason_before TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  purge_reason TEXT NULL,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS ix_exam_attempt_purge_log_attempt ON exam_attempt_purge_log (attempt_id);
CREATE INDEX IF NOT EXISTS ix_exam_attempt_purge_log_purged_at ON exam_attempt_purge_log (purged_at);