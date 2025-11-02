-- Add link from questao to exam_type (1:N) and index
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS exam_type_id INT NULL;

ALTER TABLE public.questao
  ADD CONSTRAINT IF NOT EXISTS fk_questao_exam_type
  FOREIGN KEY (exam_type_id)
  REFERENCES public.exam_type (id)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questao_exam_type_id
  ON public.questao (exam_type_id);
