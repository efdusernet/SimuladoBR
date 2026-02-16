-- Marketplace DB schema (Option B: second database)
-- Core content tables: vendors, packs, pack versions, questions, options, taxonomy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS marketplace;

-- Vendors (sellers)
CREATE TABLE IF NOT EXISTS marketplace.vendors (
  vendor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Packs (product)
CREATE TABLE IF NOT EXISTS marketplace.packs (
  pack_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES marketplace.vendors(vendor_id),
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  language text NOT NULL DEFAULT 'pt-BR',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packs_status_check CHECK (status IN ('draft','review','published','suspended')),
  CONSTRAINT packs_vendor_slug_unique UNIQUE (vendor_id, slug)
);

-- Immutable versions
CREATE TABLE IF NOT EXISTS marketplace.pack_versions (
  pack_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES marketplace.packs(pack_id),
  version text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  checksum text,
  question_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published',
  CONSTRAINT pack_versions_status_check CHECK (status IN ('published','deprecated')),
  CONSTRAINT pack_versions_pack_version_unique UNIQUE (pack_id, version)
);

-- Questions
CREATE TABLE IF NOT EXISTS marketplace.questions (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_version_id uuid NOT NULL REFERENCES marketplace.pack_versions(pack_version_id),
  prompt text NOT NULL,
  type text NOT NULL DEFAULT 'single',
  difficulty integer NOT NULL DEFAULT 3,
  explanation text,
  is_math boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_type_check CHECK (type IN ('single','multiple','text')),
  CONSTRAINT questions_difficulty_check CHECK (difficulty BETWEEN 1 AND 5)
);

-- Options/alternatives
CREATE TABLE IF NOT EXISTS marketplace.question_options (
  option_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES marketplace.questions(question_id) ON DELETE CASCADE,
  label text,
  text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  explanation text
);

-- Exam catalog (PMP, OAB1F, etc.)
CREATE TABLE IF NOT EXISTS marketplace.exam_catalog (
  exam_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_catalog_code_unique UNIQUE (code)
);

-- Taxonomy nodes (generic tree per exam)
CREATE TABLE IF NOT EXISTS marketplace.taxonomy_nodes (
  node_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES marketplace.exam_catalog(exam_id),
  parent_id uuid REFERENCES marketplace.taxonomy_nodes(node_id),
  kind text NOT NULL,
  code text,
  name text NOT NULL,
  status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_kind_check CHECK (kind IN ('domain','area','discipline','topic','tag'))
);

-- Link questions to taxonomy nodes
CREATE TABLE IF NOT EXISTS marketplace.question_taxonomy (
  question_id uuid NOT NULL REFERENCES marketplace.questions(question_id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES marketplace.taxonomy_nodes(node_id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, node_id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_packs_vendor ON marketplace.packs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pack_versions_pack ON marketplace.pack_versions(pack_id);
CREATE INDEX IF NOT EXISTS idx_questions_pack_version ON marketplace.questions(pack_version_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON marketplace.question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_exam ON marketplace.taxonomy_nodes(exam_id);
