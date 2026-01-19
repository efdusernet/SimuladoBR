/*
  052_create_flashcard_attempt_answer.sql

  Stores the current answer state for each flashcard within an attempt.
  This is UPDATED (upsert) on toggle, not appended.

  We snapshot flashcard classification at answer time so analytics can be grouped by
  idprincipio, iddominio_desempenho, idabordagem and basics.
*/

CREATE TABLE IF NOT EXISTS public.flashcard_attempt_answer (
  id BIGSERIAL PRIMARY KEY,
  attempt_id BIGINT NOT NULL,
  user_id INTEGER NOT NULL,
  flashcard_id BIGINT NOT NULL,
  correct BOOLEAN NOT NULL,
  id_versao_pmbok INTEGER,
  idprincipio INTEGER,
  iddominio_desempenho INTEGER,
  idabordagem INTEGER,
  basics BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_attempt_answer_attempt'
  ) THEN
    ALTER TABLE public.flashcard_attempt_answer
      ADD CONSTRAINT fk_flashcard_attempt_answer_attempt
      FOREIGN KEY (attempt_id)
      REFERENCES public.flashcard_attempt (id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_attempt_answer_user'
  ) THEN
    ALTER TABLE public.flashcard_attempt_answer
      ADD CONSTRAINT fk_flashcard_attempt_answer_user
      FOREIGN KEY (user_id)
      REFERENCES public."Usuario" ("Id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_attempt_answer_flashcard'
  ) THEN
    ALTER TABLE public.flashcard_attempt_answer
      ADD CONSTRAINT fk_flashcard_attempt_answer_flashcard
      FOREIGN KEY (flashcard_id)
      REFERENCES public.flashcard (id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_flashcard_attempt_answer_attempt_flashcard'
  ) THEN
    ALTER TABLE public.flashcard_attempt_answer
      ADD CONSTRAINT uq_flashcard_attempt_answer_attempt_flashcard
      UNIQUE (attempt_id, flashcard_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_attempt
  ON public.flashcard_attempt_answer (attempt_id);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_user
  ON public.flashcard_attempt_answer (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_user_principio
  ON public.flashcard_attempt_answer (user_id, idprincipio);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_user_dominio_desempenho
  ON public.flashcard_attempt_answer (user_id, iddominio_desempenho);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_user_abordagem
  ON public.flashcard_attempt_answer (user_id, idabordagem);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_answer_user_basics
  ON public.flashcard_attempt_answer (user_id, basics);
