import { PublicKey } from "@solana/web3.js";
import { PoolSnapshotPayload } from "./payloads";

// 布局锚定：discriminator(8) + admin(32) + total_assets(8) + active_capital(8)
// + reserve_fund(8) + insurance_fund(8) + pending_dividends(8) + platform_wallet(32)
// + nav(8) + paused(1) + usdc_mint(32) + lp_mint(32) + escrow_funded(8)
// + redemption_price(8) + redeem_window_epoch(8) + redeem_window_used(8)
// + pending_admin(32) + pending_admin_proposed_at(8) + fee_apy_bps(8)
// + lp_share_bps(8) + platform_share_bps(8) + rebate_share_bps(8) + first_loss_reserve(8)
// + min_insurance_abs(8) + overdue_fee_apy_bps(8) + pending_admin_delay_secs(8)
// + tracked_vault(8) + pending_gov_action(1) + pending_gov_proposed_at(8)
// + pending_gov_pubkey(32) + pending_gov_u64s(32) = 402。
// 审计 H-1 链上强制多签（尾部追加，不改变既有偏移）：
// + multisig(1 discriminant + 32) + multisig_vault_index(1) + pending_multisig(32)
// + pending_multisig_proposed_at(8) + pending_multisig_delay_secs(8)
// + pending_multisig_vault_index(1) = 485。
// 与 state.rs PoolState::space() 逐字段一致。
export const POOL_STATE_ACCOUNT_SIZE = 486;
/** 旧版合约 PoolState 布局（初始版）：disc(8)+admin(32)+5×u64+platform_wallet(32)+nav(8)=120。
 * 链上已存在的旧池账户仍为 120 字节；解析器需兼容（前缀偏移一致，扩展字段取默认值）。 */
export const LEGACY_POOL_STATE_ACCOUNT_SIZE = 120;

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
const OFFSET_MIN_INSURANCE_ABS = OFFSET_FIRST_LOSS_RESERVE + U64_SIZE;
const OFFSET_OVERDUE_FEE_APY_BPS = OFFSET_MIN_INSURANCE_ABS + U64_SIZE;
const OFFSET_PENDING_ADMIN_DELAY_SECS = OFFSET_OVERDUE_FEE_APY_BPS + U64_SIZE;
const OFFSET_TRACKED_VAULT = OFFSET_PENDING_ADMIN_DELAY_SECS + U64_SIZE;
const OFFSET_PENDING_GOV_ACTION = OFFSET_TRACKED_VAULT + U64_SIZE;
const OFFSET_PENDING_GOV_PROPOSED_AT = OFFSET_PENDING_GOV_ACTION + 1;
const OFFSET_PENDING_GOV_PUBKEY = OFFSET_PENDING_GOV_PROPOSED_AT + U64_SIZE;
const OFFSET_PENDING_GOV_U64S = OFFSET_PENDING_GOV_PUBKEY + PUBKEY_SIZE;
const OFFSET_MULTISIG_TAG = OFFSET_PENDING_GOV_U64S + 4 * U64_SIZE;
const OFFSET_MULTISIG_VALUE = OFFSET_MULTISIG_TAG + 1;
const OFFSET_MULTISIG_VAULT_INDEX = OFFSET_MULTISIG_VALUE + PUBKEY_SIZE;
const OFFSET_PENDING_MULTISIG = OFFSET_MULTISIG_VAULT_INDEX + 1;
const OFFSET_PENDING_MULTISIG_PROPOSED_AT = OFFSET_PENDING_MULTISIG + PUBKEY_SIZE;
const OFFSET_PENDING_MULTISIG_DELAY_SECS = OFFSET_PENDING_MULTISIG_PROPOSED_AT + U64_SIZE;
const OFFSET_PENDING_MULTISIG_VAULT_INDEX = OFFSET_PENDING_MULTISIG_DELAY_SECS + U64_SIZE;
const OFFSET_REQUIRE_MULTISIG = OFFSET_PENDING_MULTISIG_VAULT_INDEX + 1;

export function parsePoolStateBuffer(
  data: Buffer,
  poolAddress: string,
  capturedAt = new Date(),
): PoolSnapshotPayload {
  if (data.length < LEGACY_POOL_STATE_ACCOUNT_SIZE) {
    throw new Error(`invalid PoolState buffer length: ${data.length}`);
  }
  const legacy = data.length < POOL_STATE_ACCOUNT_SIZE;

  const totalAssets = data.readBigUInt64LE(OFFSET_TOTAL_ASSETS);
  const activeCapital = data.readBigUInt64LE(OFFSET_ACTIVE_CAPITAL);
  const reserveFund = data.readBigUInt64LE(OFFSET_RESERVE_FUND);
  const insuranceFund = data.readBigUInt64LE(OFFSET_INSURANCE_FUND);
  const pendingDividends = data.readBigUInt64LE(OFFSET_PENDING_DIVIDENDS);
  const nav = data.readBigUInt64LE(OFFSET_NAV);
  const utilizationBps =
    totalAssets > 0n ? Number((activeCapital * 10_000n) / totalAssets) : 0;

  // 扩展字段仅在新布局（>=485 字节）中存在；旧布局统一取默认值，避免越界读取。
  const paused = legacy ? false : data.readUInt8(OFFSET_PAUSED) === 1;
  const escrowFunded = legacy ? 0n : data.readBigUInt64LE(OFFSET_ESCROW_FUNDED);
  const redemptionPrice = legacy ? 0n : data.readBigUInt64LE(OFFSET_REDEMPTION_PRICE);
  const redeemWindowEpoch = legacy ? 0n : data.readBigInt64LE(OFFSET_REDEEM_WINDOW_EPOCH);
  const redeemWindowUsed = legacy ? 0n : data.readBigUInt64LE(OFFSET_REDEEM_WINDOW_USED);
  const pendingAdmin = legacy
    ? "11111111111111111111111111111111"
    : new PublicKey(
        data.subarray(OFFSET_PENDING_ADMIN, OFFSET_PENDING_ADMIN + PUBKEY_SIZE),
      ).toBase58();
  const pendingAdminProposedAt = legacy
    ? 0n
    : data.readBigInt64LE(OFFSET_PENDING_ADMIN_PROPOSED_AT);
  const feeApyBps = legacy ? 0n : data.readBigUInt64LE(OFFSET_FEE_APY_BPS);
  const lpShareBps = legacy ? 0n : data.readBigUInt64LE(OFFSET_LP_SHARE_BPS);
  const platformShareBps = legacy ? 0n : data.readBigUInt64LE(OFFSET_PLATFORM_SHARE_BPS);
  const rebateShareBps = legacy ? 0n : data.readBigUInt64LE(OFFSET_REBATE_SHARE_BPS);
  const firstLossReserve = legacy ? 0n : data.readBigUInt64LE(OFFSET_FIRST_LOSS_RESERVE);
  const minInsuranceAbs = legacy ? 0n : data.readBigUInt64LE(OFFSET_MIN_INSURANCE_ABS);
  const overdueFeeApyBps = legacy ? 0n : data.readBigUInt64LE(OFFSET_OVERDUE_FEE_APY_BPS);
  const pendingAdminDelaySecs = legacy
    ? 0n
    : data.readBigInt64LE(OFFSET_PENDING_ADMIN_DELAY_SECS);
  const multisigTag = legacy ? 0 : data.readUInt8(OFFSET_MULTISIG_TAG);
  const multisig =
    multisigTag === 1
      ? new PublicKey(
          data.subarray(OFFSET_MULTISIG_VALUE, OFFSET_MULTISIG_VALUE + PUBKEY_SIZE),
        ).toBase58()
      : null;
  const multisigVaultIndex = legacy ? 0 : data.readUInt8(OFFSET_MULTISIG_VAULT_INDEX);
  const pendingMultisig = legacy
    ? "11111111111111111111111111111111"
    : new PublicKey(
        data.subarray(OFFSET_PENDING_MULTISIG, OFFSET_PENDING_MULTISIG + PUBKEY_SIZE),
      ).toBase58();
  const pendingMultisigProposedAt = legacy
    ? 0n
    : data.readBigInt64LE(OFFSET_PENDING_MULTISIG_PROPOSED_AT);
  const pendingMultisigDelaySecs = legacy
    ? 0n
    : data.readBigInt64LE(OFFSET_PENDING_MULTISIG_DELAY_SECS);
  const pendingMultisigVaultIndex = legacy
    ? 0
    : data.readUInt8(OFFSET_PENDING_MULTISIG_VAULT_INDEX);
  const requireMultisig = legacy
    ? false
    : data.readUInt8(OFFSET_REQUIRE_MULTISIG) === 1;

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
    minInsuranceAbs: minInsuranceAbs.toString(10),
    overdueFeeApyBps: overdueFeeApyBps.toString(10),
    pendingAdminDelaySecs: pendingAdminDelaySecs.toString(10),
    multisig,
    multisigVaultIndex,
    pendingMultisig,
    pendingMultisigProposedAt: pendingMultisigProposedAt.toString(10),
    pendingMultisigDelaySecs: pendingMultisigDelaySecs.toString(10),
    pendingMultisigVaultIndex,
    requireMultisig,
    capturedAt: capturedAt.toISOString(),
  };
}