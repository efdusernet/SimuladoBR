-- 028_alter_task_add_id_dominio.sql
-- Add id_dominio column to task and FK to dominiogeral(id)

ALTER TABLE public.task
  ADD COLUMN IF NOT EXISTS id_dominio INTEGER NULL;

ALTER TABLE public.task
  ADD CONSTRAINT task_id_dominio_fk FOREIGN KEY (id_dominio)
    REFERENCES public.dominiogeral(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_id_dominio ON public.task(id_dominio);
