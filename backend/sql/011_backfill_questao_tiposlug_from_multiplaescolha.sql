-- 011: Backfill questao.tiposlug based on questao.multiplaescolha for legacy questions
-- Only set tiposlug where it is currently NULL to avoid overwriting manually assigned types
UPDATE public.questao
   SET tiposlug = CASE WHEN COALESCE(multiplaescolha, FALSE) THEN 'multi' ELSE 'single' END
 WHERE tiposlug IS NULL;