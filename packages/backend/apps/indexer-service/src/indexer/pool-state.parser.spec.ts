import { Keypair } from "@solana/web3.js";
import { parsePoolStateBuffer, POOL_STATE_ACCOUNT_SIZE } from "./pool-state.parser";

describe("parsePoolStateBuffer", () => {
  it("decodes pool fields and utilization", () => {
    const admin = Keypair.generate().publicKey;
    const buf = Buffer.alloc(POOL_STATE_ACCOUNT_SIZE);
    admin.toBuffer().copy(buf, 8);
    buf.writeBigUInt64LE(100_000_000_000n, 40);
    buf.writeBigUInt64LE(40_000_000_000n, 48);
    buf.writeBigUInt64LE(10_000_000_000n, 56);
    buf.writeBigUInt64LE(5_000_000_000n, 64);
    buf.writeBigUInt64LE(1_000_000n, 72);
    Keypair.generate().publicKey.toBuffer().copy(buf, 80);
    buf.writeBigUInt64LE(98_000_000n, 112);

    const payload = parsePoolStateBuffer(buf, "pool-pda");
    expect(payload.totalAssets).toBe("100000000000");
    expect(payload.nav).toBe("98000000");
    expect(payload.utilizationBps).toBe(4000);
  });
});
