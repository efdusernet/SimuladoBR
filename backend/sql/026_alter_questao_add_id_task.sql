-- 026_alter_questao_add_id_task.sql
-- Add id_task foreign key column to questao referencing task(id)

ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS id_task INTEGER NULL;

ALTER TABLE public.questao
  ADD CONSTRAINT questao_id_task_fk FOREIGN KEY (id_task)
    REFERENCES public.task(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Optional index to speed filtering by task
CREATE INDEX IF NOT EXISTS idx_questao_id_task ON public.questao(id_task);
