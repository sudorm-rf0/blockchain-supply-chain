-- CreateTable
CREATE TABLE "financing_requests" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "invoiceAmount" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "discountRate" INTEGER NOT NULL,
    "tenorDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "repaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financing_requests_status_idx" ON "financing_requests"("status");

-- CreateIndex
CREATE INDEX "financing_requests_applicantId_idx" ON "financing_requests"("applicantId");

-- CreateIndex
CREATE INDEX "financing_requests_invoiceId_idx" ON "financing_requests"("invoiceId");
