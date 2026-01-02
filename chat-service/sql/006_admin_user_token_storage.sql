-- Store attendant/admin tokens for audit purposes.
-- Tokens are stored encrypted (app-level), so the DB never sees plaintext.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS token_encrypted TEXT NULL;
