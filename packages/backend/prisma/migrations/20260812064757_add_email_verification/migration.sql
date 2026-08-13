-- DropForeignKey
ALTER TABLE "TradeDeal" DROP CONSTRAINT "TradeDeal_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "TradeDeal" DROP CONSTRAINT "TradeDeal_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "files" DROP CONSTRAINT "files_uploaderId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- 存量用户视为已验证（避免上线后既有账号无法登录）
UPDATE "User" SET "emailVerified" = true WHERE "emailVerified" = false;
