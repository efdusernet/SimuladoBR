-- 025_create_task.sql
-- Create task table for associating questions (questao.id_task)
-- Table stores master tasks: descricao + ativo flag

CREATE TABLE IF NOT EXISTS public.task (
  id SERIAL PRIMARY KEY,
  descricao TEXT NOT NULL,
  ativo BOOLEAN DEFAULT TRUE,
  datacadastro TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  dataalteracao TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Basic index for active tasks ordering
CREATE INDEX IF NOT EXISTS idx_task_ativo ON public.task (ativo);
