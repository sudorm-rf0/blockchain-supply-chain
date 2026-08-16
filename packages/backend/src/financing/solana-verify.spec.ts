import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { findUsdcTransfer, type TransferSpec } from "./solana-verify";

const MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const FROM = new PublicKey("8gRg8wBPkT4ej3WPAVDc9nwKYoyypPFjHc2tUreCZM7t");
const TO = new PublicKey("3rF9fK7hQwQKqVVJnpTTb1PRV3gspkPJXZP8WtZQc4fG");

function fakeTx(source: string, destination: string, amount: string) {
  return {
    transaction: { message: { instructions: [] } },
    meta: {
      err: null,
      innerInstructions: [
        {
          instructions: [
            {
              programId: TOKEN_PROGRAM_ID,
              parsed: { type: "transfer", info: { source, destination, amount } },
            },
          ],
        },
      ],
    },
  } as never;
}

describe("findUsdcTransfer (审计 H-4)", () => {
  const fromAta = getAssociatedTokenAddressSync(MINT, FROM).toBase58();
  const toAta = getAssociatedTokenAddressSync(MINT, TO).toBase58();
  const spec: TransferSpec = { from: FROM, to: TO, minAmount: 1_000_000n };

  it("命中：金额恰好等于下限", () => {
    expect(findUsdcTransfer(fakeTx(fromAta, toAta, "1000000"), MINT, spec)).toBe(true);
  });

  it("命中：金额高于下限", () => {
    expect(findUsdcTransfer(fakeTx(fromAta, toAta, "1500000"), MINT, spec)).toBe(true);
  });

  it("拒绝：金额不足", () => {
    expect(findUsdcTransfer(fakeTx(fromAta, toAta, "999999"), MINT, spec)).toBe(false);
  });

  it("拒绝：收款账户不匹配", () => {
    const other = getAssociatedTokenAddressSync(MINT, new PublicKey("11111111111111111111111111111111")).toBase58();
    expect(findUsdcTransfer(fakeTx(fromAta, other, "1000000"), MINT, spec)).toBe(false);
  });

  it("拒绝：非 transfer 指令", () => {
    const tx = {
      transaction: { message: { instructions: [] } },
      meta: { err: null, innerInstructions: [{ instructions: [{ programId: TOKEN_PROGRAM_ID, parsed: { type: "mintTo", info: {} } }] }] },
    } as never;
    expect(findUsdcTransfer(tx, MINT, spec)).toBe(false);
  });
});
