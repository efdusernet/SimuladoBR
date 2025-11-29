-- 026: Add audit user columns to questao if they do not exist
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS criadousuario INTEGER;
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS alteradousuario INTEGER;

-- Optional: set defaults for existing rows where null
-- (Removido preenchimento automático com 1; manter NULL para histórico desconhecido
--  será preenchido em futuras atualizações ou migrações específicas.)

-- Add foreign keys to Usuario table if not present (case-sensitive table requires quoting)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_questao_criadousuario_usuario'
  ) THEN
    ALTER TABLE public.questao
      ADD CONSTRAINT fk_questao_criadousuario_usuario FOREIGN KEY (criadousuario) REFERENCES public."Usuario"("Id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_questao_alteradousuario_usuario'
  ) THEN
    ALTER TABLE public.questao
      ADD CONSTRAINT fk_questao_alteradousuario_usuario FOREIGN KEY (alteradousuario) REFERENCES public."Usuario"("Id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END$$;

COMMENT ON COLUMN public.questao.criadousuario IS 'Usuário que criou a questão';
COMMENT ON COLUMN public.questao.alteradousuario IS 'Último usuário que alterou a questão';
