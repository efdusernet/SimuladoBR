-- Add roles to admin_users so we can have DB-backed admins and attendants.
-- root remains an env bootstrap token; DB admins can manage attendants.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'attendant';

-- Basic safety: allow only known roles.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_admin_users_role'
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT chk_admin_users_role
      CHECK (role IN ('admin', 'attendant'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_users_role_active_created_at
  ON admin_users(role, active, created_at DESC);
