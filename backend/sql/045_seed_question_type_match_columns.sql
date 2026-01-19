-- 045: Seed question type for match_columns
-- This enables using questao.tiposlug = 'match_columns' when FK to question_type is present.

INSERT INTO public.question_type (slug, nome, version, ui_schema, data_schema, grading_spec, flags, ativo)
VALUES (
  'match_columns',
  'Associar colunas (arrastar e soltar)',
  1,
  '{"ui":"match_columns","mode":"drag_drop"}'::jsonb,
  '{"kind":"match_columns","left":[{"id":"L1","text":"..."}],"right":[{"id":"R1","text":"..."}],"answerKey":{"L1":"R1"},"shuffleRight":true,"oneToOne":true}'::jsonb,
  '{"grading":"all_or_nothing"}'::jsonb,
  '{"pc":true,"mobile":false}'::jsonb,
  TRUE
)
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome,
      version = EXCLUDED.version,
      ui_schema = EXCLUDED.ui_schema,
      data_schema = EXCLUDED.data_schema,
      grading_spec = EXCLUDED.grading_spec,
      flags = EXCLUDED.flags,
      ativo = EXCLUDED.ativo;
