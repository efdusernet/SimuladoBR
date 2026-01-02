-- Limpar Dados de Conversas
--
-- ATENÇÃO: scripts destrutivos. Use com cuidado.
-- Recomendado executar em ambiente de DEV/HML.
--
-- Como executar (exemplos):
--   psql "$DATABASE_URL" -f "sql/Limpar Dados de Conversas.sql"
--
-- Este arquivo reúne:
-- 1) Limpeza total de dados de conversas/histórico (visitors/conversations/messages)
-- 2) Correção opcional de tópicos legados (move auto-resposta para auto_reply_text)

/*
  1) LIMPEZA TOTAL (recomendado)
  - Remove visitantes, conversas e mensagens.
  - NÃO mexe em admin_users, support_topics, etc.
*/
BEGIN;
TRUNCATE TABLE visitors CASCADE;
COMMIT;

/*
  1b) LIMPEZA PARCIAL (alternativa)
  - Mantém visitors, mas remove conversas e mensagens.

BEGIN;
TRUNCATE TABLE conversations CASCADE;
COMMIT;
*/

/*
  1c) LIMPEZA SOMENTE DO HISTÓRICO (alternativa)
  - Mantém conversas e visitors, mas apaga todas as mensagens.

BEGIN;
TRUNCATE TABLE messages;
COMMIT;
*/

/*
  2) CORREÇÃO DE TÓPICOS LEGADOS (opcional)
  Se você tinha tópicos antigos em que message_text era uma auto-resposta do suporte
  (ex.: "Em breve retornamos..."), isso fazia o widget enviar como role=user e mostrar "Você:".

  Este update move message_text -> auto_reply_text e troca message_text por uma frase do usuário.

  Execute apenas se fizer sentido para o seu ambiente.

BEGIN;

UPDATE support_topics
SET
  auto_reply_text = message_text,
  message_text = 'Tenho dúvida sobre ' || title || '.'
WHERE auto_reply_text IS NULL
  AND message_text ILIKE 'em breve retornamos%';

COMMIT;
*/
