-- Backfill: set exam_mode='quiz' for partial attempts (idempotent)
-- Rule: attempts with quantidade_questoes < blueprint numero_questoes are quiz
-- Case 1: exam_type exists
UPDATE exam_attempt a
SET exam_mode = 'quiz', updated_at = NOW()
FROM exam_type t
WHERE a.exam_mode IS NULL
  AND a.quantidade_questoes IS NOT NULL
  AND a.exam_type_id = t.id
  AND a.quantidade_questoes < t.numero_questoes;

-- Case 2: exam_type missing; use 180 as safe default
UPDATE exam_attempt a
SET exam_mode = 'quiz', updated_at = NOW()
WHERE a.exam_mode IS NULL
  AND a.quantidade_questoes IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM exam_type t WHERE t.id = a.exam_type_id)
  AND a.quantidade_questoes < 180;
