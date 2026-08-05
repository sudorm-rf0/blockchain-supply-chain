import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const USDC_DECIMALS = 6;
const USDC = (amount: number): number => amount * 10 ** USDC_DECIMALS;

describe("compute units measurement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.TradeFinance;
  const connection = provider.connection;

  const POOL_SEEDS = [Buffer.from("trade_finance"), Buffer.from("pool")];
  const POOL_AUTHORITY_SEEDS = [
    Buffer.from("trade_finance"),
    Buffer.from("pool_usdc"),
  ];

  let payer: anchor.web3.Keypair;
  let admin: anchor.web3.Keypair;
  let buyer: anchor.web3.Keypair;
  let seller: anchor.web3.Keypair;
  let lp: anchor.web3.Keypair;
  let platformWallet: anchor.web3.Keypair;

  let usdcMint: PublicKey;
  let lpMint: PublicKey;
  let poolStatePda: PublicKey;
  let poolAuthorityPda: PublicKey;
  let poolTokenAccount: PublicKey;
  let buyerAta: PublicKey;
  let sellerAta: PublicKey;
  let lpAta: PublicKey;
  let lpTokenAta: PublicKey;
  let platformAta: PublicKey;

  const results: { name: string; cu: number }[] = [];

  async function measure(name: string, run: () => Promise<string>): Promise<void> {
    const sig = await run();
    let tx = null;
    for (let i = 0; i < 20 && !tx; i++) {
      tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) await new Promise((r) => setTimeout(r, 100));
    }
    const logs = tx?.meta?.logMessages ?? [];
    const targetPrefix = `Program ${program.programId.toBase58()} consumed`;
    const line = logs
      .filter((l: string) => l.startsWith(targetPrefix))
      .pop();
    const cu = line ? Number(/(\d+) of \d+ compute units/.exec(line)?.[1]) : -1;
    results.push({ name, cu });
    console.log(`CU ${String(cu).padStart(6)}  ${name}`);
  }

  async function airdrop(
    pubkey: PublicKey,
    lamports = 5 * anchor.web3.LAMPORTS_PER_SOL,
  ): Promise<void> {
    const signature = await connection.requestAirdrop(pubkey, lamports);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function createAtaFor(
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve = false,
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      allowOwnerOffCurve,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    if (await connection.getAccountInfo(ata)) return ata;
    return createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      allowOwnerOffCurve,
    );
  }

  async function createAta(owner: PublicKey): Promise<PublicKey> {
    return createAtaFor(usdcMint, owner);
  }

  function dealPda(buyerKey: PublicKey, id: anchor.BN): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_finance"),
        Buffer.from("deal"),
        buyerKey.toBuffer(),
        id.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];
  }

  function documentPda(tradeId: anchor.BN, fileHash: Buffer): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_finance"),
        Buffer.from("document"),
        tradeId.toArrayLike(Buffer, "le", 8),
        fileHash,
      ],
      program.programId,
    )[0];
  }

  it("measures compute units across the full lifecycle", async () => {
    payer = anchor.web3.Keypair.generate();
    admin = anchor.web3.Keypair.generate();
    buyer = anchor.web3.Keypair.generate();
    seller = anchor.web3.Keypair.generate();
    lp = anchor.web3.Keypair.generate();
    platformWallet = anchor.web3.Keypair.generate();

    await Promise.all(
      [payer, admin, buyer, seller, lp, platformWallet].map((k) =>
        airdrop(k.publicKey),
      ),
    );

    usdcMint = await createMint(connection, payer, payer.publicKey, null, USDC_DECIMALS);
    lpMint = await createMint(connection, payer, payer.publicKey, null, 0);
    poolStatePda = PublicKey.findProgramAddressSync(POOL_SEEDS, program.programId)[0];
    poolAuthorityPda = PublicKey.findProgramAddressSync(
      POOL_AUTHORITY_SEEDS,
      program.programId,
    )[0];

    buyerAta = await createAta(buyer.publicKey);
    sellerAta = await createAta(seller.publicKey);
    lpAta = await createAta(lp.publicKey);
    lpTokenAta = await createAtaFor(lpMint, lp.publicKey);
    platformAta = await createAta(platformWallet.publicKey);
    poolTokenAccount = await createAtaFor(usdcMint, poolAuthorityPda, true);

    await mintTo(connection, payer, usdcMint, lpAta, payer.publicKey, USDC(100_000));
    await mintTo(connection, payer, usdcMint, buyerAta, payer.publicKey, USDC(2_000));
    await mintTo(connection, payer, lpMint, lpTokenAta, payer.publicKey, 100_000);

    // initialize_pool
    await measure("initialize_pool", () =>
      program.methods
        .initializePool(platformWallet.publicKey)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc(),
    );

    // get_pool_info (view)
    await measure("get_pool_info", () =>
      program.methods
        .getPoolInfo()
        .accounts({ poolState: poolStatePda })
        .rpc(),
    );

    // deposit_pool
    await measure("deposit_pool", () =>
      program.methods
        .depositPool(new anchor.BN(USDC(100_000)))
        .accounts({
          poolState: poolStatePda,
          depositor: lp.publicKey,
          depositorTokenAccount: lpAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([lp])
        .rpc(),
    );

    // create_deal (deal 1)
    const tradeId1 = new anchor.BN(1);
    const deal1 = dealPda(buyer.publicKey, tradeId1);
    const deal1TokenAccount = await createAtaFor(usdcMint, deal1, true);
    await measure("create_deal", () =>
      program.methods
        .createDeal(tradeId1, seller.publicKey, new anchor.BN(USDC(1_000)), new anchor.BN(30))
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal: deal1,
          buyerTokenAccount: buyerAta,
          dealTokenAccount: deal1TokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );

    // attest_document (short URI, with deal)
    const fileHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const shortUri = "ipfs://bafybeig7/export-invoice-trade-1.pdf";
    const doc1 = documentPda(tradeId1, fileHash);
    await measure("attest_document (uri=40B)", () =>
      program.methods
        .attestDocument(tradeId1, fileHash, shortUri)
        .accounts({
          owner: buyer.publicKey,
          document: doc1,
          deal: deal1,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );

    // attest_document (long URI, standalone)
    const longHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const longUri = "ipfs://long/" + "x".repeat(240);
    const longDoc = documentPda(new anchor.BN(0), longHash);
    await measure("attest_document (uri=250B)", () =>
      program.methods
        .attestDocument(new anchor.BN(0), longHash, longUri)
        .accounts({
          owner: buyer.publicKey,
          document: longDoc,
          deal: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );

    // fund_deal
    await measure("fund_deal", () =>
      program.methods
        .fundDeal(tradeId1)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: buyer.publicKey,
          deal: deal1,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          dealTokenAccount: deal1TokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
    );

    // advance_deal steps
    for (const target of [2, 3, 4]) {
      await measure(`advance_deal -> ${target}`, () =>
        program.methods
          .advanceDeal(tradeId1, target)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: buyer.publicKey,
            deal: deal1,
          })
          .signers([admin])
          .rpc(),
      );
    }

    // release_to_seller
    await measure("release_to_seller", () =>
      program.methods
        .releaseToSeller(tradeId1)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: buyer.publicKey,
          deal: deal1,
          dealTokenAccount: deal1TokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
    );

    // repay_deal
    await measure("repay_deal", () =>
      program.methods
        .repayDeal(tradeId1)
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal: deal1,
          buyerTokenAccount: buyerAta,
          platformTokenAccount: platformAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc(),
    );

    // refresh_nav
    await measure("refresh_nav", () =>
      program.methods
        .refreshNav()
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
        })
        .signers([admin])
        .rpc(),
    );

    // deal 2 -> default_deal (default directly from FUNDED)
    const tradeId2 = new anchor.BN(2);
    const deal2 = dealPda(buyer.publicKey, tradeId2);
    const deal2TokenAccount = await createAtaFor(usdcMint, deal2, true);
    await measure("create_deal (2nd)", () =>
      program.methods
        .createDeal(tradeId2, seller.publicKey, new anchor.BN(USDC(500)), new anchor.BN(120))
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal: deal2,
          buyerTokenAccount: buyerAta,
          dealTokenAccount: deal2TokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );
    await measure("fund_deal (2nd)", () =>
      program.methods
        .fundDeal(tradeId2)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: buyer.publicKey,
          deal: deal2,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          dealTokenAccount: deal2TokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
    );
    await measure("default_deal", () =>
      program.methods
        .defaultDeal(tradeId2)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: buyer.publicKey,
          deal: deal2,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          dealTokenAccount: deal2TokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          lpMint,
        })
        .signers([admin])
        .rpc(),
    );

    // redeem_lp
    await measure("redeem_lp", () =>
      program.methods
        .redeemLp(new anchor.BN(5_000))
        .accounts({
          poolState: poolStatePda,
          lpUser: lp.publicKey,
          lpUserTokenAccount: lpTokenAta,
          lpUserUsdcTokenAccount: lpAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([lp])
        .rpc(),
    );

    console.log("\n===== CU SUMMARY =====");
    for (const r of results) {
      console.log(`${r.name.padEnd(24)} ${String(r.cu).padStart(6)} CU`);
    }
  });
});
