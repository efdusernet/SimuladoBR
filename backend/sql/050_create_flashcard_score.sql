/*
  050_create_flashcard_score.sql

  Stores user scoring/answers for flashcards so we can compute correct/incorrect
  grouped by: idprincipio, iddominio_desempenho, idabordagem and basics.

  We snapshot the flashcard's classification fields at answer time to keep
  history stable even if flashcard metadata changes later.
*/

CREATE TABLE IF NOT EXISTS public.flashcard_score (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  flashcard_id BIGINT NOT NULL,
  correct BOOLEAN NOT NULL,
  id_versao_pmbok INTEGER,
  idprincipio INTEGER,
  iddominio_desempenho INTEGER,
  idabordagem INTEGER,
  basics BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign keys (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_score_user'
  ) THEN
    ALTER TABLE public.flashcard_score
      ADD CONSTRAINT fk_flashcard_score_user
      FOREIGN KEY (user_id)
      REFERENCES public."Usuario" ("Id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_score_flashcard'
  ) THEN
    ALTER TABLE public.flashcard_score
      ADD CONSTRAINT fk_flashcard_score_flashcard
      FOREIGN KEY (flashcard_id)
      REFERENCES public.flashcard (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes to support per-user analytics
CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_created_at
  ON public.flashcard_score (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_correct
  ON public.flashcard_score (user_id, correct);

CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_idprincipio
  ON public.flashcard_score (user_id, idprincipio);

CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_iddominio_desempenho
  ON public.flashcard_score (user_id, iddominio_desempenho);

CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_idabordagem
  ON public.flashcard_score (user_id, idabordagem);

CREATE INDEX IF NOT EXISTS idx_flashcard_score_user_basics
  ON public.flashcard_score (user_id, basics);
