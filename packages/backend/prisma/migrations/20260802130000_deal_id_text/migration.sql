-- TradeDeal.dealId holds an on-chain u64; store it as text so the full
-- unsigned range is preserved (BigInt columns reject values above 2^53 in JS).
ALTER TABLE "TradeDeal" ALTER COLUMN "dealId" SET DATA TYPE TEXT;
