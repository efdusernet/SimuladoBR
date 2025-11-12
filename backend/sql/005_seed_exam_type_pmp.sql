-- Seed default PMP type
INSERT INTO exam_type (
  slug, nome, numero_questoes, duracao_minutos, opcoes_por_questao, multipla_selecao,
  pontuacao_minima_percent, pausa_permitida, pausa_duracao_minutos, pausa_checkpoints,
  scoring_policy, config, ativo
) VALUES (
  'pmp', 'PMP', 180, 230, 4, FALSE,
  NULL, TRUE, 10, '[60,120]',
  '{"mode":"all-or-nothing"}', '{}', TRUE
) ON CONFLICT (slug) DO NOTHING;
