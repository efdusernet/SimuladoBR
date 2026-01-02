-- Store email for admin/attendant identities so we can invite by email.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS email TEXT NULL;

-- Make email unique when present.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_unique
  ON admin_users(email)
  WHERE email IS NOT NULL;
