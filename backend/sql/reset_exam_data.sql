-- reset_exam_data.sql
-- ATENÇÃO: Limpa completamente dados de tentativas de exame.
-- Execute APENAS em ambientes de desenvolvimento ou teste.
-- Sequências são reiniciadas; usuários e exam_type são preservados por padrão.
-- Para incluir exam_type, descomente a linha indicada.

BEGIN;
TRUNCATE TABLE exam_attempt_answer RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt_question RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt RESTART IDENTITY CASCADE;
-- Opcional: remover tipos (descomente se realmente quiser limpar tipos também)
-- TRUNCATE TABLE exam_type RESTART IDENTITY CASCADE;
COMMIT;

-- Uso com psql (exemplo):
--   psql -h localhost -U seu_usuario -d seu_banco -f backend/sql/reset_exam_data.sql
-- Verifique se a variável PGHOST/PGUSER/PGDATABASE está definida ou passe parâmetros.
