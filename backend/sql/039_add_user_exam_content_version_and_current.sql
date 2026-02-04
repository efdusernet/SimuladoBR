-- Support multiple exam content versions per exam type and allow per-user assignment.
--
-- Concept:
-- - exam_content_version: stores versions (many per exam_type)
-- - exam_content_current_version: one "default" version per exam_type (admin-controlled)
-- - user_exam_content_version: optional per-user override (usually set after purchase)

-- 1) Allow multiple versions per exam_type by dropping any unique constraint on exam_type_id
DO $$
DECLARE
  c RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class cl
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relname = 'exam_content_version'
      AND cl.relkind = 'r'
  ) THEN
    -- Drop common auto-generated constraint name (created by UNIQUE column)
    BEGIN
      EXECUTE 'ALTER TABLE public.exam_content_version DROP CONSTRAINT IF EXISTS exam_content_version_exam_type_id_key';
    EXCEPTION WHEN others THEN
      -- ignore
    END;

    -- Drop any other UNIQUE constraint that is exactly on (exam_type_id)
    FOR c IN (
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.exam_content_version'::regclass
        AND contype = 'u'
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.exam_content_version'::regclass AND attname = 'exam_type_id')
        ]
    ) LOOP
      BEGIN
        EXECUTE format('ALTER TABLE public.exam_content_version DROP CONSTRAINT IF EXISTS %I', c.conname);
      EXCEPTION WHEN others THEN
        -- ignore
      END;
    END LOOP;
  END IF;
END $$;

-- Prevent duplicates per exam type+code
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_content_version_type_code
  ON public.exam_content_version (exam_type_id, code);

-- 2) One default/current version per exam type (admin can change later)
CREATE TABLE IF NOT EXISTS public.exam_content_current_version (
  exam_type_id INTEGER PRIMARY KEY,
  exam_content_version_id INTEGER NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT exam_content_current_version_exam_type_fk
    FOREIGN KEY (exam_type_id)
    REFERENCES public.exam_type (id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION,
  CONSTRAINT exam_content_current_version_version_fk
    FOREIGN KEY (exam_content_version_id)
    REFERENCES public.exam_content_version (id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_content_current_version_version
  ON public.exam_content_current_version (exam_content_version_id);

-- Seed defaults (pick most recent version per exam type)
INSERT INTO public.exam_content_current_version (exam_type_id, exam_content_version_id)
SELECT v.exam_type_id, v.id
FROM (
  SELECT DISTINCT ON (exam_type_id) id, exam_type_id
  FROM public.exam_content_version
  ORDER BY exam_type_id, effective_from DESC NULLS LAST, id DESC
) v
WHERE NOT EXISTS (
  SELECT 1 FROM public.exam_content_current_version cv WHERE cv.exam_type_id = v.exam_type_id
);

-- 3) Per-user override (usually set by purchase)
CREATE TABLE IF NOT EXISTS public.user_exam_content_version (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  exam_type_id INT NOT NULL,
  exam_content_version_id INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  source TEXT NULL,
  external_reference TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_exam_content_user FOREIGN KEY (user_id) REFERENCES public.usuario("Id"),
  CONSTRAINT fk_user_exam_content_type FOREIGN KEY (exam_type_id) REFERENCES exam_type(id),
  CONSTRAINT fk_user_exam_content_version FOREIGN KEY (exam_content_version_id) REFERENCES exam_content_version(id)
);

-- At most one active assignment per (user, exam_type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_exam_content_active
  ON public.user_exam_content_version (user_id, exam_type_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_exam_content_user
  ON public.user_exam_content_version (user_id);

CREATE INDEX IF NOT EXISTS idx_user_exam_content_type
  ON public.user_exam_content_version (exam_type_id);

CREATE INDEX IF NOT EXISTS idx_user_exam_content_version
  ON public.user_exam_content_version (exam_content_version_id);
