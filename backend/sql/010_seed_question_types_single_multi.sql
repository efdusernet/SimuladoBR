-- 010: Seed basic question types for alternatives-based questions
INSERT INTO public.question_type (slug, nome, version, ui_schema, data_schema, grading_spec, flags, ativo)
VALUES
  ('single', 'Escolha Única', 1, '{"kind":"radio"}', NULL, NULL, NULL, TRUE)
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome,
      version = EXCLUDED.version,
      ui_schema = EXCLUDED.ui_schema,
      ativo = TRUE;

INSERT INTO public.question_type (slug, nome, version, ui_schema, data_schema, grading_spec, flags, ativo)
VALUES
  ('multi', 'Múltipla Seleção', 1, '{"kind":"checkbox"}', NULL, NULL, NULL, TRUE)
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome,
      version = EXCLUDED.version,
      ui_schema = EXCLUDED.ui_schema,
      ativo = TRUE;
