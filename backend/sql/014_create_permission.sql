-- Permissions table (optional granular permissions)
CREATE TABLE IF NOT EXISTS public.permission (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
