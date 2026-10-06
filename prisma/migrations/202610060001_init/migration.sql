-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CTV', 'CTV_CON');

-- CreateEnum
CREATE TYPE "UsageStatus" AS ENUM ('ACTIVE', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "parentCtvId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Key" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedStk" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "pin" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "birthDate" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "deposit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "withdrawal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "profit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payout" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "parentCommission" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "childCommission" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "adminShare" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "deposit" DECIMAL(18,4) NOT NULL,
    "withdrawal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "UsageStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodayEntry" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TodayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_parentCtvId_idx" ON "User"("parentCtvId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Key_normalizedStk_key" ON "Key"("normalizedStk");

-- CreateIndex
CREATE INDEX "Key_ownerId_archived_createdAt_idx" ON "Key"("ownerId", "archived", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE INDEX "Settlement_date_status_idx" ON "Settlement"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_workerId_date_key" ON "Settlement"("workerId", "date");

-- CreateIndex
CREATE INDEX "Usage_settlementId_status_idx" ON "Usage"("settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_keyId_platformId_key" ON "Usage"("keyId", "platformId");

-- CreateIndex
CREATE INDEX "TodayEntry_date_visible_idx" ON "TodayEntry"("date", "visible");

-- CreateIndex
CREATE UNIQUE INDEX "TodayEntry_keyId_date_key" ON "TodayEntry"("keyId", "date");

-- CreateIndex
CREATE INDEX "Idempotency_createdAt_idx" ON "Idempotency"("createdAt");

-- CreateIndex
CREATE INDEX "Audit_entityId_createdAt_idx" ON "Audit"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parentCtvId_fkey" FOREIGN KEY ("parentCtvId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "Key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodayEntry" ADD CONSTRAINT "TodayEntry_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "Key"("id") ON DELETE CASCADE ON UPDATE CASCADE;
