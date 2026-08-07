import { Keypair } from "@solana/web3.js";
import { parseTradeDealBuffer, TRADE_DEAL_ACCOUNT_SIZE } from "./trade-deal.parser";
import { parsePoolStateBuffer, POOL_STATE_ACCOUNT_SIZE } from "./pool-state.parser";

/**
 * buffer 布局锚定测试。
 *
 * 下面两张字段布局表必须与合约 `programs/trade-finance/src/state.rs`
 * 中 `TradeDeal::space()` / `PoolState::space()` 的注释逐字段一致。
 * 任何人改动合约 state 布局（新增/删除/改类型字段），必须同步：
 *   1. state.rs 的 space() 计算
 *   2. 本文件的布局表与期望 size
 *   3. 对应 parser 的偏移量与 SIZE 常量
 * 否则 indexer 会静默错位解析链上账户数据。
 */

// TradeDeal 布局（Anchor discriminator 8 字节前缀 + 各字段）：
//   8  discriminator
//   8  id (u64)
//  32  buyer (Pubkey)
//  32  seller (Pubkey)
//   8  amount (u64)
//   8  down_payment (u64)
//   8  pool_portion (u64)
//   8  tenor (i64)
//   1  status (u8)
//   8  created_at (i64)
//   8  repaid_at (i64)
const EXPECTED_TRADE_DEAL_SIZE =
  8 + 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 8;

// PoolState 布局：
//   8  discriminator
//  32  admin (Pubkey)
//   8  total_assets (u64)
//   8  active_capital (u64)
//   8  reserve_fund (u64)
//   8  insurance_fund (u64)
//   8  pending_dividends (u64)
//  32  platform_wallet (Pubkey)
//   8  nav (u64)
//   1  paused (bool)
//  32  usdc_mint (Pubkey, S-01 锚定)
//  32  lp_mint (Pubkey, S-01 锚定)
//   8  escrow_funded (审计 M-01)
//   8  redemption_price (审计 M-04)
//   8  redeem_window_epoch (审计 M-05)
//   8  redeem_window_used (审计 M-05)
//  32  pending_admin (审计 H-03)
//   8  pending_admin_proposed_at (审计 H-03)
//   8  fee_apy_bps (H-04)
//   8  lp_share_bps (H-04)
//   8  platform_share_bps (H-04)
//   8  rebate_share_bps (H-04)
//   8  first_loss_reserve (H-04)
//   8  min_insurance_abs (L-07)
//   8  overdue_fee_apy_bps (L-04)
//   8  pending_admin_delay_secs (N-02)
//   8  tracked_vault (独立复测 H-3)
const EXPECTED_POOL_STATE_SIZE =
  8 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 8 + 1 + 32 + 32 + 8 + 8 + 8 + 8 + 32 + 8 +
  8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8;

describe("chain account layout anchor", () => {
  it("TradeDeal parser size matches state.rs layout", () => {
    expect(EXPECTED_TRADE_DEAL_SIZE).toBe(129);
    expect(TRADE_DEAL_ACCOUNT_SIZE).toBe(EXPECTED_TRADE_DEAL_SIZE);
  });

  it("PoolState parser size matches state.rs layout", () => {
    expect(EXPECTED_POOL_STATE_SIZE).toBe(329);
    expect(POOL_STATE_ACCOUNT_SIZE).toBe(EXPECTED_POOL_STATE_SIZE);
  });

  it("TradeDeal round-trips a minimal account buffer", () => {
    const buyer = Keypair.generate().publicKey;
    const seller = Keypair.generate().publicKey;
    const buf = Buffer.alloc(TRADE_DEAL_ACCOUNT_SIZE);
    buf.writeBigUInt64LE(7n, 8);
    buyer.toBuffer().copy(buf, 16);
    seller.toBuffer().copy(buf, 48);
    buf.writeBigUInt64LE(1_000_000n, 80);
    buf.writeBigUInt64LE(300_000n, 88);
    buf.writeBigUInt64LE(700_000n, 96);
    buf.writeBigInt64LE(30n, 104);
    buf.writeUInt8(1, 112);
    buf.writeBigInt64LE(1_700_000_000n, 113);
    buf.writeBigInt64LE(0n, 121);

    const payload = parseTradeDealBuffer(buf, "deal-pda");
    expect(payload.tradeId).toBe("7");
    expect(payload.buyerWallet).toBe(buyer.toBase58());
    expect(payload.sellerWallet).toBe(seller.toBase58());
    expect(payload.status).toBe(1);
  });

  it("PoolState round-trips a minimal account buffer", () => {
    const admin = Keypair.generate().publicKey;
    const wallet = Keypair.generate().publicKey;
    const buf = Buffer.alloc(POOL_STATE_ACCOUNT_SIZE);
    admin.toBuffer().copy(buf, 8);
    buf.writeBigUInt64LE(1_000_000n, 40); // total_assets
    buf.writeBigUInt64LE(500_000n, 48);   // active_capital
    buf.writeBigUInt64LE(100_000n, 56);   // reserve_fund
    buf.writeBigUInt64LE(50_000n, 64);    // insurance_fund
    buf.writeBigUInt64LE(10_000n, 72);    // pending_dividends
    wallet.toBuffer().copy(buf, 80);      // platform_wallet
    buf.writeBigUInt64LE(990_000n, 112);  // nav
    buf.writeUInt8(1, 120);               // paused
    buf.writeBigUInt64LE(700_000n, 185);  // escrow_funded
    buf.writeBigUInt64LE(990_000n, 193);  // redemption_price
    buf.writeBigInt64LE(123n, 201);       // redeem_window_epoch
    buf.writeBigUInt64LE(10_000n, 209);   // redeem_window_used
    admin.toBuffer().copy(buf, 217);      // pending_admin
    buf.writeBigInt64LE(1_000n, 249);     // pending_admin_proposed_at
    buf.writeBigUInt64LE(670n, 257);      // fee_apy_bps
    buf.writeBigUInt64LE(4000n, 265);     // lp_share_bps
    buf.writeBigUInt64LE(5000n, 273);     // platform_share_bps
    buf.writeBigUInt64LE(1000n, 281);     // rebate_share_bps
    buf.writeBigUInt64LE(50_000n, 289);   // first_loss_reserve
    buf.writeBigUInt64LE(100_000_000n, 297); // min_insurance_abs
    buf.writeBigUInt64LE(0n, 305);           // overdue_fee_apy_bps
    buf.writeBigInt64LE(172_800n, 313);      // pending_admin_delay_secs

    const payload = parsePoolStateBuffer(buf, "pool-pda");
    expect(payload.poolAddress).toBe("pool-pda");
    expect(payload.totalAssets).toBe("1000000");
    expect(payload.activeCapital).toBe("500000");
    expect(payload.nav).toBe("990000");
    expect(payload.paused).toBe(true);
    expect(payload.escrowFunded).toBe("700000");
    expect(payload.redemptionPrice).toBe("990000");
    expect(payload.redeemWindowEpoch).toBe("123");
    expect(payload.redeemWindowUsed).toBe("10000");
    expect(payload.pendingAdmin).toBe(admin.toBase58());
    expect(payload.feeApyBps).toBe("670");
    expect(payload.lpShareBps).toBe("4000");
    expect(payload.firstLossReserve).toBe("50000");
    expect(payload.minInsuranceAbs).toBe("100000000");
    expect(payload.overdueFeeApyBps).toBe("0");
    expect(payload.pendingAdminDelaySecs).toBe("172800");
  });


  it("rejects a TradeDeal buffer shorter than the anchored size", () => {
    expect(() =>
      parseTradeDealBuffer(Buffer.alloc(TRADE_DEAL_ACCOUNT_SIZE - 1), "deal"),
    ).toThrow(/invalid TradeDeal buffer length/);
  });

  it("rejects a PoolState buffer shorter than the anchored size", () => {
    expect(() =>
      parsePoolStateBuffer(Buffer.alloc(POOL_STATE_ACCOUNT_SIZE - 1), "pool"),
    ).toThrow(/invalid PoolState buffer length/);
  });
});
