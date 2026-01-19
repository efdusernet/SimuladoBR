/*
  053_add_status_to_flashcard_attempt.sql

  Adds a lifecycle status to flashcard_attempt so background jobs (pgAgent/cron)
  can mark idle attempts as abandoned without deleting history.

  Status values:
    - active
    - finished
    - abandoned
*/

ALTER TABLE public.flashcard_attempt
  ADD COLUMN IF NOT EXISTS status TEXT;

-- Backfill + default
UPDATE public.flashcard_attempt
   SET status = CASE
     WHEN finished_at IS NOT NULL THEN 'finished'
     ELSE 'active'
   END
 WHERE status IS NULL;

ALTER TABLE public.flashcard_attempt
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.flashcard_attempt
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_flashcard_attempt_status'
  ) THEN
    ALTER TABLE public.flashcard_attempt
      ADD CONSTRAINT ck_flashcard_attempt_status
      CHECK (status IN ('active', 'finished', 'abandoned'));
  END IF;
END $$;

-- Helps the job find stale active attempts quickly
CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_status_started
  ON public.flashcard_attempt (status, started_at);
