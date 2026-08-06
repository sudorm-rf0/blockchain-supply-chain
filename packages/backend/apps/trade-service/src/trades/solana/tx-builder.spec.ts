import { PublicKey } from "@solana/web3.js";
import { TRADE_ENV } from "../../config/env";
import {
  buildRepayDealTransaction,
  deriveRebatePda,
  SYSTEM_PROGRAM_ID,
} from "./tx-builder";

function poolStateData(platformWallet: PublicKey): Buffer {
  const buf = Buffer.alloc(120);
  platformWallet.toBuffer().copy(buf, 88);
  return buf;
}

describe("buildRepayDealTransaction", () => {
  it("includes rebate ledger and system program accounts", async () => {
    const buyer = PublicKey.unique();
    const platformWallet = PublicKey.unique();
    const connection = {
      getAccountInfo: jest
        .fn()
        .mockResolvedValueOnce({ data: poolStateData(platformWallet) })
        .mockResolvedValueOnce(null),
      getLatestBlockhash: jest
        .fn()
        .mockResolvedValue({ blockhash: "b", lastValidBlockHeight: 1 }),
    } as never;

    const { transaction } = await buildRepayDealTransaction(
      {
        tradeId: 1n,
        buyer,
        usdcMint: new PublicKey(TRADE_ENV.usdcMint),
      },
      connection as never,
    );
    const programIx = transaction.instructions[transaction.instructions.length - 1];
    const keys = programIx.keys.map((k) => k.pubkey);
    const rebate = deriveRebatePda(
      new PublicKey(TRADE_ENV.programId),
      buyer,
    );
    expect(keys).toContainEqual(rebate);
    expect(keys).toContainEqual(SYSTEM_PROGRAM_ID);
    expect(keys).toHaveLength(12);
  });
});
