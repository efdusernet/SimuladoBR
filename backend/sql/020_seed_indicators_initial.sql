-- Seed initial indicator registry rows (idempotent by codigo)
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND1',
       'Exames Realizados Resultados 30 dias',
       'Somatório de tentativas de exames com 180 questões nos últimos X dias (padrão 30).',
       '/pages/Indicadores.html',
       '#sec-geral',
       'COUNT(exam_attempt WHERE quantidade_questoes=180 AND finished_at >= NOW() - (X days))',
    '{{"diasPadrao":30,"alternativas":[30,60],"examMode":["quiz","full"],"idUsuario":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND1');

INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND2',
       '% de aprovação no período',
       '(Exames com score_percent >= 75% * 100) / Exames no período (padrão 30 dias).',
       '/pages/Indicadores.html',
       '#sec-geral',
       '(COUNT WHERE score_percent>=75 / COUNT total) * 100',
    '{{"diasPadrao":30,"examMode":["quiz","full"],"idUsuario":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND2');
