-- Create a single, admin-editable "current exam content version" per exam type
-- and link ECO rows to that version.
--
-- Goal: you do NOT keep multiple concurrent versions; admin updates this table when PMI changes.

CREATE TABLE IF NOT EXISTS public.exam_content_version (
  id SERIAL PRIMARY KEY,
  exam_type_id INTEGER NOT NULL UNIQUE,
  code TEXT NOT NULL,
  effective_from DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT exam_content_version_exam_type_fk
    FOREIGN KEY (exam_type_id)
    REFERENCES public.exam_type (id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION
);

-- Seed one row per existing exam_type (safe if re-run)
INSERT INTO public.exam_content_version (exam_type_id, code, effective_from)
SELECT et.id, (et.slug || '-vigente')::text AS code, CURRENT_DATE
FROM public.exam_type et
WHERE NOT EXISTS (
  SELECT 1 FROM public.exam_content_version v WHERE v.exam_type_id = et.id
);

-- Add ECO link column if ECO table exists (supports legacy quoted name)
DO $$
BEGIN
  -- Unquoted table name (most common in Postgres): public.eco
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'eco'
      AND c.relkind = 'r'
  ) THEN
    EXECUTE 'ALTER TABLE public.eco ADD COLUMN IF NOT EXISTS exam_content_version_id INTEGER';

    -- Add FK constraint once
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'eco_exam_content_version_fk'
    ) THEN
      EXECUTE 'ALTER TABLE public.eco ADD CONSTRAINT eco_exam_content_version_fk FOREIGN KEY (exam_content_version_id) REFERENCES public.exam_content_version(id) ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID';
    END IF;

    -- Best-effort backfill:
    -- 1) If eco has exam_type_id column
    BEGIN
      EXECUTE 'UPDATE public.eco e SET exam_content_version_id = v.id FROM public.exam_content_version v WHERE e.exam_content_version_id IS NULL AND v.exam_type_id = e.exam_type_id';
    EXCEPTION WHEN others THEN
      -- ignore (schema may differ)
    END;

    -- 2) If eco.id matches exam_type.id (common legacy pattern)
    BEGIN
      EXECUTE 'UPDATE public.eco e SET exam_content_version_id = v.id FROM public.exam_content_version v WHERE e.exam_content_version_id IS NULL AND v.exam_type_id = e.id';
    EXCEPTION WHEN others THEN
      -- ignore (schema may differ)
    END;

    -- If still NULL, bind to the first available version (keeps system running; admin can adjust later)
    EXECUTE 'UPDATE public.eco SET exam_content_version_id = (SELECT id FROM public.exam_content_version ORDER BY id LIMIT 1) WHERE exam_content_version_id IS NULL';

    -- Only enforce NOT NULL if everything has been populated
    IF NOT EXISTS (SELECT 1 FROM public.eco WHERE exam_content_version_id IS NULL LIMIT 1) THEN
      EXECUTE 'ALTER TABLE public.eco ALTER COLUMN exam_content_version_id SET NOT NULL';
    END IF;
  END IF;

  -- Quoted table name: public."ECO"
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ECO'
      AND c.relkind = 'r'
  ) THEN
    EXECUTE 'ALTER TABLE public."ECO" ADD COLUMN IF NOT EXISTS exam_content_version_id INTEGER';

    -- Add FK constraint once
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'ECO_exam_content_version_fk'
    ) THEN
      EXECUTE 'ALTER TABLE public."ECO" ADD CONSTRAINT ECO_exam_content_version_fk FOREIGN KEY (exam_content_version_id) REFERENCES public.exam_content_version(id) ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID';
    END IF;

    -- Best-effort backfill:
    -- 1) If "ECO" has exam_type_id column
    BEGIN
      EXECUTE 'UPDATE public."ECO" e SET exam_content_version_id = v.id FROM public.exam_content_version v WHERE e.exam_content_version_id IS NULL AND v.exam_type_id = e.exam_type_id';
    EXCEPTION WHEN others THEN
      -- ignore (schema may differ)
    END;

    -- 2) If "ECO".id matches exam_type.id (common legacy pattern)
    BEGIN
      EXECUTE 'UPDATE public."ECO" e SET exam_content_version_id = v.id FROM public.exam_content_version v WHERE e.exam_content_version_id IS NULL AND v.exam_type_id = e.id';
    EXCEPTION WHEN others THEN
      -- ignore (schema may differ)
    END;

    -- If still NULL, bind to the first available version (keeps system running; admin can adjust later)
    EXECUTE 'UPDATE public."ECO" SET exam_content_version_id = (SELECT id FROM public.exam_content_version ORDER BY id LIMIT 1) WHERE exam_content_version_id IS NULL';

    -- Only enforce NOT NULL if everything has been populated
    IF NOT EXISTS (SELECT 1 FROM public."ECO" WHERE exam_content_version_id IS NULL LIMIT 1) THEN
      EXECUTE 'ALTER TABLE public."ECO" ALTER COLUMN exam_content_version_id SET NOT NULL';
    END IF;
  END IF;
END $$;
