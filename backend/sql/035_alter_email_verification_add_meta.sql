-- Migration 035: Add Meta field to EmailVerification table
-- This field stores JSON metadata for verification tokens (e.g., email change requests)

ALTER TABLE "EmailVerification" ADD COLUMN IF NOT EXISTS "Meta" TEXT;

COMMENT ON COLUMN "EmailVerification"."Meta" IS 'JSON metadata for verification context (e.g., {"type": "email_change", "newEmail": "..."})';