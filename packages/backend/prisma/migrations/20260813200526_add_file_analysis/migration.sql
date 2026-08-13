-- AlterTable
ALTER TABLE "files" ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "authResult" JSONB,
ADD COLUMN     "authScore" INTEGER,
ADD COLUMN     "authStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ocrLang" TEXT,
ADD COLUMN     "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ocrText" TEXT,
ADD COLUMN     "region" TEXT;
