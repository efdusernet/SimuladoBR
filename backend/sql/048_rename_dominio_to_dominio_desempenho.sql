/*
  048_rename_dominio_to_dominio_desempenho.sql

  Renames legacy table public.dominio -> public.dominio_desempenho.
  Idempotent: only renames when old exists and new does not.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'dominio'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'dominio_desempenho'
  ) THEN
    ALTER TABLE public.dominio RENAME TO dominio_desempenho;
  END IF;
END $$;
