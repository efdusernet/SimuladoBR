-- Add planned real exam date to Usuario
-- Stored as TEXT in dd/mm/yyyy format per product requirement.

ALTER TABLE public."Usuario"
  ADD COLUMN IF NOT EXISTS data_exame TEXT NULL;
