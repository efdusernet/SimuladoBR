-- 008: Add extensibility columns to questao
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS tiposlug TEXT NULL,
  ADD COLUMN IF NOT EXISTS interacaospec JSONB NULL,
  ADD COLUMN IF NOT EXISTS correctspec JSONB NULL,
  ADD COLUMN IF NOT EXISTS scoringpolicy JSONB NULL;

-- Optional FK to question_type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema='public' AND table_name='question_type'
  ) THEN
    ALTER TABLE public.questao
      ADD CONSTRAINT fk_questao_question_type
      FOREIGN KEY (tiposlug) REFERENCES public.question_type(slug)
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END$$;

-- Helpful index
CREATE INDEX IF NOT EXISTS ix_questao_tiposlug ON public.questao(tiposlug);
