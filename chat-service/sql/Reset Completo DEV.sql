-- Reset Completo DEV
--
-- ATENÇÃO: script EXTREMAMENTE destrutivo.
-- Indicado apenas para ambiente local / desenvolvimento.
--
-- O que este reset remove:
-- - visitors + conversations + messages (histórico completo)
-- - admin_users (admins/atendentes/tokens)
-- - support_topics (assuntos do widget)
--
-- NÃO mexe em extensões nem recria schema/migrations.

BEGIN;

-- 1) Conversas + histórico (CASCADE apaga conversations e messages)
TRUNCATE TABLE visitors CASCADE;

-- 2) Usuários admin/atendentes (após truncar conversas, não há FK pendente)
TRUNCATE TABLE admin_users;

-- 3) Assuntos do widget
TRUNCATE TABLE support_topics;

COMMIT;

-- Opcional (mais agressivo): se quiser garantir que nada fique, você pode truncar tudo
-- explicitamente com CASCADE, mas isso geralmente não é necessário:
--
-- BEGIN;
-- TRUNCATE TABLE messages;
-- TRUNCATE TABLE conversations;
-- TRUNCATE TABLE visitors;
-- TRUNCATE TABLE admin_users;
-- TRUNCATE TABLE support_topics;
-- COMMIT;
