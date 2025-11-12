-- Make option_id nullable to allow persisting unanswered questions as NULL
ALTER TABLE exam_attempt_answer
  ALTER COLUMN option_id DROP NOT NULL;
