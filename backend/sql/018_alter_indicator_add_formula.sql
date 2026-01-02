-- Add formula_calculo column to indicator if it does not exist (idempotent)
ALTER TABLE indicator
  ADD COLUMN IF NOT EXISTS formula_calculo TEXT NULL;
