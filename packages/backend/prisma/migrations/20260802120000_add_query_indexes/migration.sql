-- Add query indexes for time-series and list filtering paths.
CREATE INDEX "TradeDeal_createdAt_idx" ON "TradeDeal"("createdAt");
CREATE INDEX "withdraw_requests_requestedAt_idx" ON "withdraw_requests"("requestedAt");
CREATE INDEX "files_createdAt_idx" ON "files"("createdAt");
CREATE INDEX "files_tradeId_idx" ON "files"("tradeId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
