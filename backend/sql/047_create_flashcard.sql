-- Flashcards linked to PMBOK (ECO) content versions
-- Fields per request:
-- - pergunta (texto)
-- - resposta (texto)
-- - id_versao_pmbok (FK -> exam_content_version.id)
-- - data_cadastro (timestamptz, default NOW())
-- - data_alteracao (timestamptz, default NOW(); maintained by trigger)
-- - idprincipio (integer, nullable)
-- - iddominio_desempenho (integer, nullable)
-- - idabordagem (integer, nullable)
-- - basics (boolean, default false)

CREATE TABLE IF NOT EXISTS public.flashcard (
  id BIGSERIAL PRIMARY KEY,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  id_versao_pmbok INTEGER NOT NULL DEFAULT 2,
  data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_alteracao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idprincipio INTEGER,
  iddominio_desempenho INTEGER,
  idabordagem INTEGER,
  basics BOOLEAN DEFAULT FALSE,
  CONSTRAINT fk_flashcard_exam_content_version
    FOREIGN KEY (id_versao_pmbok)
    REFERENCES public.exam_content_version (id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION
);

-- Ensure new columns exist even if the table already existed
ALTER TABLE IF EXISTS public.flashcard
  ADD COLUMN IF NOT EXISTS idprincipio INTEGER,
  ADD COLUMN IF NOT EXISTS iddominio_desempenho INTEGER,
  ADD COLUMN IF NOT EXISTS idabordagem INTEGER,
  ADD COLUMN IF NOT EXISTS basics BOOLEAN DEFAULT FALSE;

-- Ensure default is present even if the table already existed
ALTER TABLE IF EXISTS public.flashcard
  ALTER COLUMN id_versao_pmbok SET DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_flashcard_id_versao_pmbok
  ON public.flashcard (id_versao_pmbok);

-- Keep data_alteracao current on updates
CREATE OR REPLACE FUNCTION public.set_flashcard_data_alteracao()
RETURNS TRIGGER AS $$
BEGIN
  NEW.data_alteracao = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flashcard_data_alteracao ON public.flashcard;
CREATE TRIGGER trg_flashcard_data_alteracao
BEFORE UPDATE ON public.flashcard
FOR EACH ROW EXECUTE FUNCTION public.set_flashcard_data_alteracao();
