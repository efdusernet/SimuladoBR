-- Drops all objects created by sql/001_init.sql
-- Use with care. This is destructive.

DROP INDEX IF EXISTS idx_messages_conversation_id_created_at;
DROP INDEX IF EXISTS idx_conversations_visitor_id;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS visitors;

DROP EXTENSION IF EXISTS pgcrypto;
