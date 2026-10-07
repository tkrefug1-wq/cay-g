CREATE TYPE "DataType" AS ENUM ('REAL', 'VIRTUAL');

ALTER TABLE "Key" ADD COLUMN "dataType" "DataType" NOT NULL DEFAULT 'REAL';

CREATE INDEX "Key_ownerId_dataType_archived_idx" ON "Key"("ownerId", "dataType", "archived");
