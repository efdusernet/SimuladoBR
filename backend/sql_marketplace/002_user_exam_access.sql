-- Marketplace DB access checks (exam-level)
-- NOTE: All access/eligibility checks for multi-exam routing should live here.

CREATE SCHEMA IF NOT EXISTS marketplace;

-- Seed catalog with baseline exams (idempotent)
INSERT INTO marketplace.exam_catalog (code, name, status)
VALUES
  ('PMP', 'PMP (Clássico)', TRUE),
  ('OAB1F', 'OAB 1ª Fase', TRUE)
ON CONFLICT (code) DO NOTHING;

-- User → exam access table (links to Core user via core_user_id, no cross-db join required)
CREATE TABLE IF NOT EXISTS marketplace.user_exam_access (
  access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_user_id bigint NOT NULL,
  exam_id uuid NOT NULL REFERENCES marketplace.exam_catalog(exam_id) ON DELETE CASCADE,
  status boolean NOT NULL DEFAULT true,
  starts_at timestamptz NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_exam_access_unique UNIQUE (core_user_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_user_exam_access_user ON marketplace.user_exam_access(core_user_id);
CREATE INDEX IF NOT EXISTS idx_user_exam_access_exam ON marketplace.user_exam_access(exam_id);
