-- Seed the "% de reprovação no período" indicator (idempotent)
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND3',
       '% de reprovação no período',
       '(Exames com score_percent < 75% * 100) / Exames no período (padrão 30 dias).',
       '/pages/Indicadores.html',
       '#sec-geral',
       '(COUNT WHERE score_percent<75 / COUNT total) * 100',
    '{{"diasPadrao":30,"examMode":["quiz","full"],"idUsuario":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND3');
