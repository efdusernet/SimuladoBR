-- Add link from explicacaoguia to respostaopcao so we can store one explanation per option.

ALTER TABLE public.explicacaoguia
  ADD COLUMN IF NOT EXISTS idrespostaopcao integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'explicacao_respostaopcao'
  ) THEN
    ALTER TABLE public.explicacaoguia
      ADD CONSTRAINT explicacao_respostaopcao
      FOREIGN KEY (idrespostaopcao)
      REFERENCES public.respostaopcao (id)
      ON UPDATE NO ACTION
      ON DELETE NO ACTION
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_explicacaoguia_questao_opcao
  ON public.explicacaoguia (idquestao, idrespostaopcao);

-- Enforce one active explanation row per (question, option).
-- Note: NULL idrespostaopcao rows (legacy/general) are allowed and not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS ux_explicacaoguia_questao_opcao_active
  ON public.explicacaoguia (idquestao, idrespostaopcao)
  WHERE (idrespostaopcao IS NOT NULL) AND (excluido = FALSE OR excluido IS NULL);
