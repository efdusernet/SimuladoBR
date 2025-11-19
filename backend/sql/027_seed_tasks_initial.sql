-- 027_seed_tasks_initial.sql
-- Seed a few initial tasks (adjust or remove as needed)
INSERT INTO public.task (descricao, ativo) VALUES
  ('Revisar conceitos Agile', TRUE),
  ('Verificar processos de qualidade', TRUE),
  ('Mapear riscos exemplo', TRUE),
  ('Atualizar estudo de stakeholders', TRUE)
ON CONFLICT DO NOTHING;