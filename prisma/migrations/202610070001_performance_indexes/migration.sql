CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Key_fullName_trgm_idx" ON "Key" USING GIN (lower("fullName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Key_bank_trgm_idx" ON "Key" USING GIN (lower("bank") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Key_normalizedStk_trgm_idx" ON "Key" USING GIN ("normalizedStk" gin_trgm_ops);
