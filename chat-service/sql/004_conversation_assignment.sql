-- Assign an attendant (admin_users) to a conversation for exclusive replying.
-- Keeps conversations readable by all attendants, but only the assignee can reply.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_admin_user_id UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_admin_user_id
  ON conversations(assigned_admin_user_id);
