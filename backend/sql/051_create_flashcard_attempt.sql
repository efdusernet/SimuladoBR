/*
  051_create_flashcard_attempt.sql

  A "game" session for flashcards. All answer logs are tied to an attempt_id.
*/

CREATE TABLE IF NOT EXISTS public.flashcard_attempt (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  id_versao_pmbok INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_attempt_user'
  ) THEN
    ALTER TABLE public.flashcard_attempt
      ADD CONSTRAINT fk_flashcard_attempt_user
      FOREIGN KEY (user_id)
      REFERENCES public.usuario ("Id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_user_started
  ON public.flashcard_attempt (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_flashcard_attempt_user_version
  ON public.flashcard_attempt (user_id, id_versao_pmbok);
