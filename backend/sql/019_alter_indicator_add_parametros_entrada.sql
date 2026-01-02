-- Add parametros_entrada column (JSONB) if missing
ALTER TABLE indicator
  ADD COLUMN IF NOT EXISTS parametros_entrada JSONB NULL;
