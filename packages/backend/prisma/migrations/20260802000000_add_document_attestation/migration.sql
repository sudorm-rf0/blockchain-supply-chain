-- AlterTable
ALTER TABLE "files" ADD COLUMN     "attestedAt" TIMESTAMP(3),
ADD COLUMN     "documentPda" TEXT,
ADD COLUMN     "txSignature" TEXT;
