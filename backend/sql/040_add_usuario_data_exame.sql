-- Add planned real exam date to usuario
-- Stored as TEXT in dd/mm/yyyy format per product requirement.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS data_exame TEXT NULL;
