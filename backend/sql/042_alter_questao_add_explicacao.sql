-- Adds a question-level explanation field.
-- This persists the value from admin UI textareas (explicacao / explicacaoNav).

ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS explicacao TEXT;
