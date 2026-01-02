-- 009: Add free-form response payload to exam_attempt_answer
ALTER TABLE public.exam_attempt_answer
  ADD COLUMN IF NOT EXISTS resposta JSONB NULL;

-- Optional index for querying by presence of resposta
-- CREATE INDEX IF NOT EXISTS ix_exam_attempt_answer_resposta_gin ON public.exam_attempt_answer USING GIN (resposta);
