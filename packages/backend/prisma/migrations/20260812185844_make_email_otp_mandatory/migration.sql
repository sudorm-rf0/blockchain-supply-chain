-- AlterTable
ALTER TABLE "User" ALTER COLUMN "emailOtpEnabled" SET DEFAULT true;

-- 存量真实账号强制开启（最高安全）；种子管理员在 seed 时显式设为 false
UPDATE "User" SET "emailOtpEnabled" = true WHERE "emailOtpEnabled" = false;
