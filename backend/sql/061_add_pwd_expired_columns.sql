-- 061_add_pwd_expired_columns.sql
-- Adds password-expiration columns to usuario table.
-- Normalizes possible legacy mixed-case column names to lowercase to avoid quoting issues.

DO $$
BEGIN
  -- Normalize mixed-case names if they exist (created with quotes).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdExpired'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdexpired'
  ) THEN
    ALTER TABLE public.usuario RENAME COLUMN "pwdExpired" TO pwdexpired;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdExpiredDate'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdexpireddate'
  ) THEN
    ALTER TABLE public.usuario RENAME COLUMN "pwdExpiredDate" TO pwdexpireddate;
  END IF;

  -- Ensure lowercase columns exist.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdexpired'
  ) THEN
    ALTER TABLE public.usuario
      ADD COLUMN pwdexpired BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'pwdexpireddate'
  ) THEN
    ALTER TABLE public.usuario
      ADD COLUMN pwdexpireddate TIMESTAMPTZ NULL;
  END IF;
END $$;
