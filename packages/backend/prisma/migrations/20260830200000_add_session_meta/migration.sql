-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "geoCountry" TEXT;
