import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const USDC_DECIMALS = 6;
const USDC = (amount: number): number => amount * 10 ** USDC_DECIMALS;

describe("trade-finance full lifecycle", () => {
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
  let poolStatePda: PublicKey;
  let poolAuthorityPda: PublicKey;
  let poolTokenAccount: PublicKey;
  let buyerAta: PublicKey;
  let lpAta: PublicKey;
  let platformAta: PublicKey;

  async function airdrop(
    pubkey: PublicKey,
    lamports = 5 * anchor.web3.LAMPORTS_PER_SOL,
  ): Promise<void> {
    const signature = await connection.requestAirdrop(pubkey, lamports);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function createAta(owner: PublicKey): Promise<PublicKey> {
    return createAssociatedTokenAccount(connection, payer, usdcMint, owner);
  }

  function dealPda(buyerKey: PublicKey, id: anchor.BN): PublicKey {
    return PublicKey.findProgramAddress(
      [
        Buffer.from("trade_finance"),
        Buffer.from("deal"),
        buyerKey.toBuffer(),
        id.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];
  }

  before(async () => {
    payer = anchor.web3.Keypair.generate();
    admin = anchor.web3.Keypair.generate();
    buyer = anchor.web3.Keypair.generate();
    seller = anchor.web3.Keypair.generate();
    lp = anchor.web3.Keypair.generate();
    platformWallet = anchor.web3.Keypair.generate();

    await Promise.all(
      [payer, admin, buyer, seller, lp, platformWallet].map((keypair) =>
        airdrop(keypair.publicKey),
      ),
    );

    usdcMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      USDC_DECIMALS,
    );

    poolStatePda = PublicKey.findProgramAddress(
      POOL_SEEDS,
      program.programId,
    )[0];
    poolAuthorityPda = PublicKey.findProgramAddress(
      POOL_AUTHORITY_SEEDS,
      program.programId,
    )[0];

    buyerAta = await createAta(buyer.publicKey);
    lpAta = await createAta(lp.publicKey);
    platformAta = await createAta(platformWallet.publicKey);
    poolTokenAccount = await createAta(poolAuthorityPda);

    await mintTo(
      connection,
      payer,
      usdcMint,
      lpAta,
      payer.publicKey,
      USDC(100_000),
    );
    await mintTo(
      connection,
      payer,
      usdcMint,
      buyerAta,
      payer.publicKey,
      USDC(2_000),
    );
  });

  it("Initializes Pool State", async () => {
    await program.methods
      .initializePool(platformWallet.publicKey)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .depositPool(new anchor.BN(USDC(100_000)))
      .accounts({
        poolState: poolStatePda,
        depositor: lp.publicKey,
        depositorTokenAccount: lpAta,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([lp])
      .rpc();

    const poolState = await program.account.poolState.fetch(poolStatePda);
    anchor.assert.equal(poolState.admin.toBase58(), admin.publicKey.toBase58());
    anchor.assert.equal(poolState.totalAssets.toString(), USDC(100_000).toString());
    console.log("Pool admin:", poolState.admin.toBase58());
    console.log("Pool totalAssets:", poolState.totalAssets.toString());
  });

  it("Creates a trade deal", async () => {
    const tradeId = new anchor.BN(1);
    const amount = new anchor.BN(USDC(1_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);

    await program.methods
      .createDeal(tradeId, seller.publicKey, amount, tenorDays)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    anchor.assert.equal(dealState.status, 0); // Pending
    anchor.assert.equal(dealState.buyer.toBase58(), buyer.publicKey.toBase58());
    anchor.assert.equal(dealState.seller.toBase58(), seller.publicKey.toBase58());
    anchor.assert.equal(dealState.downPayment.toString(), USDC(300).toString());
    anchor.assert.equal(dealState.poolPortion.toString(), USDC(700).toString());
    anchor.assert.equal(dealState.tenor.toString(), (30 * 86_400).toString());
    console.log("Deal PDA:", deal.toBase58());
    console.log("Deal status:", dealState.status);
  });

  it("Funds a deal", async () => {
    const tradeId = new anchor.BN(1);
    const deal = dealPda(buyer.publicKey, tradeId);

    await program.methods
      .fundDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        buyer: buyer.publicKey,
        deal,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    anchor.assert.equal(dealState.status, 1); // Funded
    anchor.assert.equal(poolState.activeCapital.toString(), USDC(700).toString());
    anchor.assert.equal(poolState.totalAssets.toString(), USDC(100_300).toString());
    console.log("Active capital:", poolState.activeCapital.toString());
    console.log("Total assets:", poolState.totalAssets.toString());
  });

  it("Repays and distributes fees", async () => {
    const tradeId = new anchor.BN(1);
    const deal = dealPda(buyer.publicKey, tradeId);

    await program.methods
      .repayDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        platformTokenAccount: platformAta,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const platformBalance = await getAccount(connection, platformAta);

    const fee = (USDC(1_000) * 250) / 10_000;
    const lpDividend = (fee * 4_000) / 10_000;
    const platformPart = (fee * 5_000) / 10_000;

    anchor.assert.equal(dealState.status, 6); // Settled
    anchor.assert.equal(poolState.pendingDividends.toString(), lpDividend.toString());
    anchor.assert.equal(platformBalance.amount, BigInt(platformPart));
    anchor.assert.equal(poolState.activeCapital.toString(), "0");
    console.log("Pending dividends:", poolState.pendingDividends.toString());
    console.log("Platform balance:", platformBalance.amount.toString());
  });

  it("Fails on over-concentration", async () => {
    const tradeId = new anchor.BN(3);
    const amount = new anchor.BN(USDC(20_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);

    let failed = false;
    try {
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, tenorDays)
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal,
          buyerTokenAccount: buyerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (error) {
      failed = true;
      console.log("Over-concentration error:", String(error));
      anchor.assert.ok(String(error).includes("OverConcentration"));
    }
    anchor.assert.ok(failed, "expected OverConcentration error");
  });

  it("Handles default scenario", async () => {
    const tradeId = new anchor.BN(4);
    const amount = new anchor.BN(USDC(1_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal);

    await program.methods
      .createDeal(tradeId, seller.publicKey, amount, tenorDays)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .fundDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        buyer: buyer.publicKey,
        deal,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    // 模拟 create/fund 后续的托管转账：买 30% 首付 + 资金池 70% 放款进入订单托管。
    await mintTo(
      connection,
      payer,
      usdcMint,
      dealTokenAccount,
      payer.publicKey,
      USDC(300),
    );
    await mintTo(
      connection,
      payer,
      usdcMint,
      dealTokenAccount,
      payer.publicKey,
      USDC(700),
    );

    const poolBefore = await getAccount(connection, poolTokenAccount);
    const poolStateBefore = await program.account.poolState.fetch(poolStatePda);
    const insurancePayout = (USDC(700) * 1_000) / 10_000;

    await program.methods
      .defaultDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const poolAfter = await getAccount(connection, poolTokenAccount);
    const dealAfter = await getAccount(connection, dealTokenAccount);

    anchor.assert.equal(dealState.status, 7); // Defaulted
    anchor.assert.equal(
      poolAfter.amount,
      poolBefore.amount + BigInt(USDC(300)) - BigInt(insurancePayout),
    );
    anchor.assert.equal(
      dealAfter.amount,
      BigInt(USDC(700)) + BigInt(insurancePayout),
    );
    anchor.assert.equal(
      poolState.insuranceFund.toString(),
      new anchor.BN(poolStateBefore.insuranceFund)
        .sub(new anchor.BN(insurancePayout))
        .toString(),
    );
    console.log("Default status:", dealState.status);
    console.log("Insurance fund:", poolState.insuranceFund.toString());
  });
});
