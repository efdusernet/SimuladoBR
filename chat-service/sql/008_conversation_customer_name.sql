-- Store a human-friendly customer name for the conversation.
-- Set by attendants/admins in the admin panel after learning the user's name.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_name TEXT NULL;
