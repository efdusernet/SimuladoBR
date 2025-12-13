-- OAuth accounts linked to existing Usuario table
-- Uses snake_case naming consistent with other tables

CREATE TABLE IF NOT EXISTS oauth_account (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK to existing users table (Usuario.Id)
ALTER TABLE oauth_account
  ADD CONSTRAINT fk_oauth_account_user
  FOREIGN KEY (user_id)
  REFERENCES "Usuario"("Id")
  ON DELETE CASCADE;

-- Avoid duplicate links to the same external account
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_provider_user
  ON oauth_account(provider, provider_user_id);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_oauth_user_id
  ON oauth_account(user_id);
