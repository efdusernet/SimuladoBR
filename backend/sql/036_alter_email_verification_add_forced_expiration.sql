-- Add ForcedExpiration column to EmailVerification table
-- Used to track tokens that were forcefully expired due to user requesting new token
-- This allows distinguishing between natural expiration and forced expiration

ALTER TABLE "EmailVerification" 
ADD COLUMN IF NOT EXISTS "ForcedExpiration" BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN "EmailVerification"."ForcedExpiration" IS 'Indicates if token was forcefully expired due to user requesting a new token of the same type';
