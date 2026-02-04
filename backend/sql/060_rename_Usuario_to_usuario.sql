-- 060_rename_Usuario_to_usuario.sql
-- Normalize legacy quoted table name "Usuario" to lowercase usuario.
-- This prevents case-sensitive quoting issues across environments.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'Usuario'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
  ) THEN
    ALTER TABLE public."Usuario" RENAME TO usuario;
  END IF;
END $$;
