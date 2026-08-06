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
const EXPECTED_POOL_STATE_SIZE = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 8 + 1;

describe("chain account layout anchor", () => {
  it("TradeDeal parser size matches state.rs layout", () => {
    expect(EXPECTED_TRADE_DEAL_SIZE).toBe(129);
    expect(TRADE_DEAL_ACCOUNT_SIZE).toBe(EXPECTED_TRADE_DEAL_SIZE);
  });

  it("PoolState parser size matches state.rs layout", () => {
    expect(EXPECTED_POOL_STATE_SIZE).toBe(121);
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

    const payload = parsePoolStateBuffer(buf, "pool-pda");
    expect(payload.poolAddress).toBe("pool-pda");
    expect(payload.totalAssets).toBe("1000000");
    expect(payload.activeCapital).toBe("500000");
    expect(payload.nav).toBe("990000");
    expect(payload.paused).toBe(true);
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
