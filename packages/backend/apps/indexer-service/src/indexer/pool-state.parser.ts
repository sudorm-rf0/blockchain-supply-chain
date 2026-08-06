import { PoolSnapshotPayload } from "./payloads";

// 布局锚定：discriminator(8) + admin(32) + total_assets(8) + active_capital(8)
// + reserve_fund(8) + insurance_fund(8) + pending_dividends(8) + platform_wallet(32)
// + nav(8) + paused(1) = 121。与 state.rs PoolState::space() 逐字段一致。
export const POOL_STATE_ACCOUNT_SIZE = 185;

const DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;
const U64_SIZE = 8;

const OFFSET_TOTAL_ASSETS = DISCRIMINATOR_SIZE + PUBKEY_SIZE;
const OFFSET_ACTIVE_CAPITAL = OFFSET_TOTAL_ASSETS + U64_SIZE;
const OFFSET_RESERVE_FUND = OFFSET_ACTIVE_CAPITAL + U64_SIZE;
const OFFSET_INSURANCE_FUND = OFFSET_RESERVE_FUND + U64_SIZE;
const OFFSET_PENDING_DIVIDENDS = OFFSET_INSURANCE_FUND + U64_SIZE;
const OFFSET_NAV = OFFSET_PENDING_DIVIDENDS + U64_SIZE + PUBKEY_SIZE;
const OFFSET_PAUSED = OFFSET_NAV + U64_SIZE;

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
  // 紧急暂停开关位于账户末尾（nav 之后）；历史账户（120 字节）视为未暂停。
  const paused = data.length > OFFSET_PAUSED ? data.readUInt8(OFFSET_PAUSED) === 1 : false;

  return {
    poolAddress,
    totalAssets: totalAssets.toString(10),
    activeCapital: activeCapital.toString(10),
    reserveFund: reserveFund.toString(10),
    insuranceFund: insuranceFund.toString(10),
    pendingDividends: pendingDividends.toString(10),
    nav: nav.toString(10),
    utilizationBps,
    paused,
    capturedAt: capturedAt.toISOString(),
  };
}
