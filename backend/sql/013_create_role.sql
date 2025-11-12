-- Roles table (system roles)
CREATE TABLE IF NOT EXISTS public.role (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed basic roles
INSERT INTO public.role (slug, nome, descricao)
SELECT 'admin', 'Administrador', 'Acesso administrativo' WHERE NOT EXISTS (SELECT 1 FROM public.role WHERE slug='admin');
INSERT INTO public.role (slug, nome, descricao)
SELECT 'aluno', 'Aluno', 'Usuário final' WHERE NOT EXISTS (SELECT 1 FROM public.role WHERE slug='aluno');
