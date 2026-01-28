/*
  057_drop_flashcard_idabordagem.sql

  Drops abordagem from flashcards (public.flashcard.idabordagem).

  IMPORTANT:
  - This migration only drops the column from public.flashcard.
  - Other tables may still contain idabordagem (e.g., flashcard_attempt_answer, flashcard_score) for historical/analytics.
  - Backend code that previously read flashcard.idabordagem must be updated accordingly (to avoid runtime SQL errors).
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'flashcard'
      AND column_name = 'idabordagem'
  ) THEN
    ALTER TABLE public.flashcard
      DROP COLUMN idabordagem;
  END IF;
END $$;
