-- AlterTable
ALTER TABLE "files" ADD COLUMN     "documentGroupId" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "files_documentGroupId_idx" ON "files"("documentGroupId");

-- CreateIndex
CREATE INDEX "files_tradeId_documentGroupId_idx" ON "files"("tradeId", "documentGroupId");
