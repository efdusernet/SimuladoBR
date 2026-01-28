/*
  055_create_dicas.sql

  CRUD Admin for "dicas".

  NOTE:
  This migration mirrors the schema shared in chat:
    - id integer default nextval('dicas_pmbok'::regclass)
    - id_versao_pmbok default 2
    - FK to exam_content_version (NOT VALID)
*/

-- Ensure the sequence used by "dicas.id" exists.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relname = 'dicas_pmbok'
		  AND c.relkind = 'S'
	) THEN
		EXECUTE 'CREATE SEQUENCE public.dicas_pmbok';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.dicas (
  id integer NOT NULL DEFAULT nextval('public.dicas_pmbok'::regclass),
  descricao text NOT NULL,
  id_versao_pmbok integer NOT NULL DEFAULT 2,
  CONSTRAINT dicas_pkey PRIMARY KEY (id)
);

-- FK constraint (idempotent) - keep NOT VALID to match existing environments
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'dicas_id_versao_pmbok_fkey'
	) THEN
		EXECUTE 'ALTER TABLE public.dicas '
			|| 'ADD CONSTRAINT dicas_id_versao_pmbok_fkey '
			|| 'FOREIGN KEY (id_versao_pmbok) '
			|| 'REFERENCES public.exam_content_version (id) '
			|| 'ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID';
	END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dicas_id_versao_pmbok
  ON public.dicas (id_versao_pmbok);
