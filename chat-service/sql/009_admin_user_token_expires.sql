-- Expiration for invite tokens. If a token is not used before this timestamp, it becomes invalid.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ NULL;
