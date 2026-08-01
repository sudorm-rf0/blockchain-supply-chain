-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('PENDING', 'FUNDED', 'IN_TRANSIT', 'CUSTOMS_CLEAR', 'DELIVERED', 'REPAYING', 'SETTLED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'READY', 'EXECUTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeDeal" (
    "id" TEXT NOT NULL,
    "dealId" BIGINT NOT NULL,
    "buyerId" TEXT,
    "sellerId" TEXT,
    "buyerWallet" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "downPayment" BIGINT NOT NULL,
    "poolPortion" BIGINT NOT NULL,
    "tenor" BIGINT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "repaidAt" TIMESTAMP(3),
    "txSignature" TEXT,
    "logisticsHash" TEXT,
    "rawData" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolSnapshot" (
    "id" TEXT NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "nav" BIGINT NOT NULL,
    "utilization" BIGINT NOT NULL,
    "totalAssets" BIGINT NOT NULL,
    "activeCapital" BIGINT NOT NULL,
    "reserveFund" BIGINT NOT NULL,
    "insuranceFund" BIGINT NOT NULL,
    "pendingDividends" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdraw_requests" (
    "id" TEXT NOT NULL,
    "lpAddress" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "tradeId" TEXT,
    "description" TEXT,
    "remark" TEXT,
    "uploaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDeal_dealId_key" ON "TradeDeal"("dealId");

-- CreateIndex
CREATE INDEX "TradeDeal_status_idx" ON "TradeDeal"("status");

-- CreateIndex
CREATE INDEX "TradeDeal_buyerId_idx" ON "TradeDeal"("buyerId");

-- CreateIndex
CREATE INDEX "TradeDeal_sellerId_idx" ON "TradeDeal"("sellerId");

-- CreateIndex
CREATE INDEX "TradeDeal_buyerWallet_idx" ON "TradeDeal"("buyerWallet");

-- CreateIndex
CREATE UNIQUE INDEX "PoolSnapshot_poolAddress_capturedAt_key" ON "PoolSnapshot"("poolAddress", "capturedAt");

-- CreateIndex
CREATE INDEX "PoolSnapshot_poolAddress_capturedAt_idx" ON "PoolSnapshot"("poolAddress", "capturedAt");

-- CreateIndex
CREATE INDEX "withdraw_requests_lpAddress_status_idx" ON "withdraw_requests"("lpAddress", "status");

-- CreateIndex
CREATE INDEX "files_status_idx" ON "files"("status");

-- AddForeignKey
ALTER TABLE "TradeDeal" ADD CONSTRAINT "TradeDeal_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDeal" ADD CONSTRAINT "TradeDeal_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
