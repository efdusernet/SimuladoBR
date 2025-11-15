-- Seed indicators 4-6 (idempotent)
-- 4) Quantidade questões do simulador
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND4',
       'Quantidade questões do simulador',
       'Total de questões disponíveis (excluido=false, idstatus=1). Parâmetro opcional examTypeId.',
       '/pages/Indicadores.html',
       '#sec-geral',
       'COUNT(questao WHERE excluido=false AND idstatus=1 [AND exam_type_id = :examTypeId])',
       '{{"examTypeId":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND4');

-- 5) Quantidade questões respondidas (por usuário)
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND5',
       'Quantidade questões respondidas',
       'Qtd. distinta de questões respondidas pelo usuário (JOIN exam_attempt/question/answer) por examTypeId.',
       '/pages/Indicadores.html',
       '#sec-geral',
       'COUNT(DISTINCT aq.question_id WHERE a.user_id=:idUsuario AND a.exam_type_id=:examTypeId)',
       '{{"examTypeId":1,"idUsuario":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND5');

-- 6) Total horas no simulador (por usuário)
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND6',
       'Total horas no simulador',
       'Soma do tempo gasto por questão (exam_attempt_question.tempo_gasto_segundos) por usuário/examTypeId.',
       '/pages/Indicadores.html',
       '#sec-geral',
       'SUM(aq.tempo_gasto_segundos)/3600 WHERE a.user_id=:idUsuario AND a.exam_type_id=:examTypeId',
       '{{"examTypeId":1,"idUsuario":null}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND6');
