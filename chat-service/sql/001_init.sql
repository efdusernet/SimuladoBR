-- Optional reset (manual): drops all objects created by this migration.
-- NOTE: Keep these commented to avoid accidental data loss when applying migrations.
-- To reset, copy/paste into psql (or use scripts/dropAll.sql).
--
-- DROP INDEX IF EXISTS idx_messages_conversation_id_created_at;
-- DROP INDEX IF EXISTS idx_conversations_visitor_id;
--
-- DROP TABLE IF EXISTS messages;
-- DROP TABLE IF EXISTS conversations;
-- DROP TABLE IF EXISTS visitors;
--
-- DROP EXTENSION IF EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS visitors (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE RESTRICT,
  user_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  origin TEXT NOT NULL DEFAULT 'widget',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_visitor_id ON conversations(visitor_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);
