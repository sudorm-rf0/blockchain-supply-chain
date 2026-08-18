-- CreateTable
CREATE TABLE "visit_logs" (
    "id" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "referrer" TEXT,
    "userId" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_logs_createdAt_idx" ON "visit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "visit_logs_path_idx" ON "visit_logs"("path");

-- CreateIndex
CREATE INDEX "visit_logs_ip_idx" ON "visit_logs"("ip");
