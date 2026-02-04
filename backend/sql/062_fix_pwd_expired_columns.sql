-- 062_fix_pwd_expired_columns.sql
-- Best-effort fix for inconsistent password-expiration column names.
--
-- Some environments may have created the date column with the wrong name/type.
-- Canonical (unquoted) columns used by the app are:
--   - pwdexpired      BOOLEAN
--   - pwdexpireddate  TIMESTAMPTZ
--
-- This migration is idempotent and tries to:
--  1) If `pwdexpired` exists but is a timestamp-like type AND `pwdexpireddate` is missing,
--     rename `pwdexpired` -> `pwdexpireddate`.
--  2) Ensure `pwdexpired` boolean exists.
--  3) Ensure `pwdexpireddate` timestamptz exists.

DO $$
DECLARE
  pwdexpired_udt text;
BEGIN
  -- Detect current type of column pwdexpired (if exists)
  SELECT c.udt_name INTO pwdexpired_udt
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='usuario' AND c.column_name='pwdexpired'
  LIMIT 1;

  -- If pwdexpired exists but is timestamp-like, it was likely meant to be pwdExpiredDate.
  IF pwdexpired_udt IS NOT NULL
     AND pwdexpired_udt IN ('timestamptz','timestamp','timestampz')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='usuario' AND column_name='pwdexpireddate'
     )
  THEN
    ALTER TABLE public.usuario RENAME COLUMN pwdexpired TO pwdexpireddate;
    pwdexpired_udt := NULL;
  END IF;

  -- Ensure boolean flag exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usuario' AND column_name='pwdexpired'
  ) THEN
    ALTER TABLE public.usuario ADD COLUMN pwdexpired BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- Ensure date column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usuario' AND column_name='pwdexpireddate'
  ) THEN
    ALTER TABLE public.usuario ADD COLUMN pwdexpireddate TIMESTAMPTZ NULL;
  END IF;
END $$;
