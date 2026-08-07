import { PublicKey } from "@solana/web3.js";
import { PoolSnapshotPayload } from "./payloads";

// 布局锚定：discriminator(8) + admin(32) + total_assets(8) + active_capital(8)
// + reserve_fund(8) + insurance_fund(8) + pending_dividends(8) + platform_wallet(32)
// + nav(8) + paused(1) + usdc_mint(32) + lp_mint(32) + escrow_funded(8)
// + redemption_price(8) + redeem_window_epoch(8) + redeem_window_used(8)
// + pending_admin(32) + pending_admin_proposed_at(8) + fee_apy_bps(8)
// + lp_share_bps(8) + platform_share_bps(8) + rebate_share_bps(8) + first_loss_reserve(8) = 297。
// 与 state.rs PoolState::space() 逐字段一致。
export const POOL_STATE_ACCOUNT_SIZE = 297;

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
// paused(1) 之后为 usdc_mint(32)、lp_mint(32)，再后为 escrow_funded。
const OFFSET_ESCROW_FUNDED = OFFSET_PAUSED + 1 + PUBKEY_SIZE + PUBKEY_SIZE;
const OFFSET_REDEMPTION_PRICE = OFFSET_ESCROW_FUNDED + U64_SIZE;
const OFFSET_REDEEM_WINDOW_EPOCH = OFFSET_REDEMPTION_PRICE + U64_SIZE;
const OFFSET_REDEEM_WINDOW_USED = OFFSET_REDEEM_WINDOW_EPOCH + U64_SIZE;
const OFFSET_PENDING_ADMIN = OFFSET_REDEEM_WINDOW_USED + U64_SIZE;
const OFFSET_PENDING_ADMIN_PROPOSED_AT = OFFSET_PENDING_ADMIN + PUBKEY_SIZE;
const OFFSET_FEE_APY_BPS = OFFSET_PENDING_ADMIN_PROPOSED_AT + U64_SIZE;
const OFFSET_LP_SHARE_BPS = OFFSET_FEE_APY_BPS + U64_SIZE;
const OFFSET_PLATFORM_SHARE_BPS = OFFSET_LP_SHARE_BPS + U64_SIZE;
const OFFSET_REBATE_SHARE_BPS = OFFSET_PLATFORM_SHARE_BPS + U64_SIZE;
const OFFSET_FIRST_LOSS_RESERVE = OFFSET_REBATE_SHARE_BPS + U64_SIZE;

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
  const paused = data.readUInt8(OFFSET_PAUSED) === 1;
  const escrowFunded = data.readBigUInt64LE(OFFSET_ESCROW_FUNDED);
  const redemptionPrice = data.readBigUInt64LE(OFFSET_REDEMPTION_PRICE);
  const redeemWindowEpoch = data.readBigInt64LE(OFFSET_REDEEM_WINDOW_EPOCH);
  const redeemWindowUsed = data.readBigUInt64LE(OFFSET_REDEEM_WINDOW_USED);
  const pendingAdmin = new PublicKey(
    data.subarray(OFFSET_PENDING_ADMIN, OFFSET_PENDING_ADMIN + PUBKEY_SIZE),
  ).toBase58();
  const pendingAdminProposedAt = data.readBigInt64LE(
    OFFSET_PENDING_ADMIN_PROPOSED_AT,
  );
  const feeApyBps = data.readBigUInt64LE(OFFSET_FEE_APY_BPS);
  const lpShareBps = data.readBigUInt64LE(OFFSET_LP_SHARE_BPS);
  const platformShareBps = data.readBigUInt64LE(OFFSET_PLATFORM_SHARE_BPS);
  const rebateShareBps = data.readBigUInt64LE(OFFSET_REBATE_SHARE_BPS);
  const firstLossReserve = data.readBigUInt64LE(OFFSET_FIRST_LOSS_RESERVE);

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
    escrowFunded: escrowFunded.toString(10),
    redemptionPrice: redemptionPrice.toString(10),
    redeemWindowEpoch: redeemWindowEpoch.toString(10),
    redeemWindowUsed: redeemWindowUsed.toString(10),
    pendingAdmin,
    pendingAdminProposedAt: pendingAdminProposedAt.toString(10),
    feeApyBps: feeApyBps.toString(10),
    lpShareBps: lpShareBps.toString(10),
    platformShareBps: platformShareBps.toString(10),
    rebateShareBps: rebateShareBps.toString(10),
    firstLossReserve: firstLossReserve.toString(10),
    capturedAt: capturedAt.toISOString(),
  };
}
