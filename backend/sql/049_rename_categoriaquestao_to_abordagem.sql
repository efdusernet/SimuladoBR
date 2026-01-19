/*
  049_rename_categoriaquestao_to_abordagem.sql

  Renames legacy table public.categoriaquestao -> public.abordagem.
  Idempotent: only renames when old exists and new does not.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'categoriaquestao'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'abordagem'
  ) THEN
    ALTER TABLE public.categoriaquestao RENAME TO abordagem;
  END IF;
END $$;
