-- 007: Create question_type registry for extensible question kinds
CREATE TABLE IF NOT EXISTS public.question_type (
  slug TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  ui_schema JSONB,
  data_schema JSONB,
  grading_spec JSONB,
  flags JSONB,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Helpful index for active types
CREATE INDEX IF NOT EXISTS ix_question_type_ativo ON public.question_type(ativo);
