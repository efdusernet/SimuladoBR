-- Seed default roles if not exists
INSERT INTO public.role (slug, nome, ativo)
SELECT 'admin', 'Administrador', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.role WHERE slug = 'admin');

INSERT INTO public.role (slug, nome, ativo)
SELECT 'aluno', 'Aluno', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.role WHERE slug = 'aluno');
