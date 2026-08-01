import { PoolSnapshotPayload } from "./payloads";

export const POOL_STATE_ACCOUNT_SIZE = 120;

const DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;
const U64_SIZE = 8;

const OFFSET_TOTAL_ASSETS = DISCRIMINATOR_SIZE + PUBKEY_SIZE;
const OFFSET_ACTIVE_CAPITAL = OFFSET_TOTAL_ASSETS + U64_SIZE;
const OFFSET_RESERVE_FUND = OFFSET_ACTIVE_CAPITAL + U64_SIZE;
const OFFSET_INSURANCE_FUND = OFFSET_RESERVE_FUND + U64_SIZE;
const OFFSET_PENDING_DIVIDENDS = OFFSET_INSURANCE_FUND + U64_SIZE;
const OFFSET_NAV = OFFSET_PENDING_DIVIDENDS + U64_SIZE + PUBKEY_SIZE;

export function parsePoolStateBuffer(
  data: Buffer,
  poolAddress: string,
  capturedAt = new Date(),
): PoolSnapshotPayload {
  if (data.length < POOL_STATE_ACCOUNT_SIZE) {
    throw new Error(`invalid PoolState buffer length: ${data.length}`);
  }

  const totalAssets = data.readBigUInt64LE(OFFSET_TOTAL_ASSETS);
  const activeCapital = data.readBigUInt64LE(OFFSET_ACTIVE_CAPITAL);
  const reserveFund = data.readBigUInt64LE(OFFSET_RESERVE_FUND);
  const insuranceFund = data.readBigUInt64LE(OFFSET_INSURANCE_FUND);
  const pendingDividends = data.readBigUInt64LE(OFFSET_PENDING_DIVIDENDS);
  const nav = data.readBigUInt64LE(OFFSET_NAV);
  const utilizationBps =
    totalAssets > 0n ? Number((activeCapital * 10_000n) / totalAssets) : 0;

  return {
    poolAddress,
    totalAssets: totalAssets.toString(10),
    activeCapital: activeCapital.toString(10),
    reserveFund: reserveFund.toString(10),
    insuranceFund: insuranceFund.toString(10),
    pendingDividends: pendingDividends.toString(10),
    nav: nav.toString(10),
    utilizationBps,
    capturedAt: capturedAt.toISOString(),
  };
}
