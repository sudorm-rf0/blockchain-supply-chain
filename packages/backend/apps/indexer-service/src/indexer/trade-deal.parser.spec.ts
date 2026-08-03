import { Keypair } from "@solana/web3.js";
import { parseTradeDealBuffer, TRADE_DEAL_ACCOUNT_SIZE } from "./trade-deal.parser";

describe("parseTradeDealBuffer", () => {
  it("decodes a SETTLED deal", () => {
    const buyer = Keypair.generate().publicKey;
    const seller = Keypair.generate().publicKey;
    const buf = Buffer.alloc(TRADE_DEAL_ACCOUNT_SIZE);
    buf.writeBigUInt64LE(42n, 8);
    buyer.toBuffer().copy(buf, 16);
    seller.toBuffer().copy(buf, 48);
    buf.writeBigUInt64LE(1_000_000n, 80);
    buf.writeBigUInt64LE(300_000n, 88);
    buf.writeBigUInt64LE(700_000n, 96);
    buf.writeBigInt64LE(30n, 104);
    buf.writeUInt8(6, 112);
    buf.writeBigInt64LE(1_700_000_000n, 113);
    buf.writeBigInt64LE(1_700_010_000n, 121);

    const payload = parseTradeDealBuffer(buf, "deal-pda");
    expect(payload.tradeId).toBe("42");
    expect(payload.buyerWallet).toBe(buyer.toBase58());
    expect(payload.sellerWallet).toBe(seller.toBase58());
    expect(payload.amount).toBe("1000000");
    expect(payload.status).toBe(6);
    expect(payload.repaidAt).toBe("1700010000");
  });

  it("rejects buffers shorter than the account layout", () => {
    expect(() => parseTradeDealBuffer(Buffer.alloc(10), "deal-pda")).toThrow(
      /invalid TradeDeal buffer length/,
    );
  });

  it("rejects unknown status codes", () => {
    const buyer = Keypair.generate().publicKey;
    const seller = Keypair.generate().publicKey;
    const buf = Buffer.alloc(TRADE_DEAL_ACCOUNT_SIZE);
    buf.writeBigUInt64LE(1n, 8);
    buyer.toBuffer().copy(buf, 16);
    seller.toBuffer().copy(buf, 48);
    buf.writeUInt8(255, 112);
    expect(() => parseTradeDealBuffer(buf, "deal-pda")).toThrow(
      /unknown TradeDeal status code/,
    );
  });
});
