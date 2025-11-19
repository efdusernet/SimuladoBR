-- Seed IND7: % Acertos/Erros por Grupo de Processos (idempotent)
-- Mostra a % de questões certas x % de questões erradas relacionada a cada grupo de processos
-- no último exame completo do usuário
INSERT INTO indicator (codigo, nome, descricao, pagina, elemento_html, formula_calculo, parametros_entrada, versao_exame, ativo)
SELECT 'IND7',
       '% Acertos/Erros por Grupo de Processos',
       'Mostra a % de questões certas x % de questões erradas relacionada a cada grupo de processos no último exame completo (exam_mode=full) do usuário.',
       '/pages/Indicadores.html',
       '#sec-desempenho',
       E'Para cada grupo_processos:\n' ||
       E'  acertos = COUNT(exam_attempt_question WHERE user_correct=true)\n' ||
       E'  erros = COUNT(exam_attempt_question WHERE user_correct=false)\n' ||
       E'  total_grupo = acertos + erros\n' ||
       E'  % Acertos = (acertos / total_grupo) × 100\n' ||
       E'  % Erros = (erros / total_grupo) × 100\n' ||
       E'Resultado: array de {grupo, percentAcertos, percentErros} ordenado por grupo.',
       '{{"idUsuario":null,"idExame":null,"examMode":"full"}}',
       'PMP',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM indicator WHERE codigo = 'IND7');
