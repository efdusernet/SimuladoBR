/*
  054_create_flashcard_feedback.sql

  Stores per-user thumbs up/down feedback for flashcards.
  One vote per (user_id, flashcard_id).

  vote:
    1  = like
   -1  = dislike
*/

CREATE TABLE IF NOT EXISTS public.flashcard_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  flashcard_id BIGINT NOT NULL,
  vote SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_feedback_user'
  ) THEN
    ALTER TABLE public.flashcard_feedback
      ADD CONSTRAINT fk_flashcard_feedback_user
      FOREIGN KEY (user_id)
      REFERENCES public.usuario ("Id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_flashcard_feedback_flashcard'
  ) THEN
    ALTER TABLE public.flashcard_feedback
      ADD CONSTRAINT fk_flashcard_feedback_flashcard
      FOREIGN KEY (flashcard_id)
      REFERENCES public.flashcard (id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_flashcard_feedback_vote'
  ) THEN
    ALTER TABLE public.flashcard_feedback
      ADD CONSTRAINT ck_flashcard_feedback_vote
      CHECK (vote IN (-1, 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_flashcard_feedback_user_flashcard'
  ) THEN
    ALTER TABLE public.flashcard_feedback
      ADD CONSTRAINT uq_flashcard_feedback_user_flashcard
      UNIQUE (user_id, flashcard_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flashcard_feedback_flashcard
  ON public.flashcard_feedback (flashcard_id);

CREATE INDEX IF NOT EXISTS idx_flashcard_feedback_flashcard_vote
  ON public.flashcard_feedback (flashcard_id, vote);

CREATE INDEX IF NOT EXISTS idx_flashcard_feedback_user_updated
  ON public.flashcard_feedback (user_id, updated_at DESC);
