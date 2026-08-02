import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
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
  let lpMint: PublicKey;
  let poolStatePda: PublicKey;
  let poolAuthorityPda: PublicKey;
  let poolTokenAccount: PublicKey;
  let buyerAta: PublicKey;
  let sellerAta: PublicKey;
  let lpAta: PublicKey;
  let lpTokenAta: PublicKey;
  let platformAta: PublicKey;

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
    if (await connection.getAccountInfo(ata)) {
      return ata;
    }
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

  async function createAta(
    owner: PublicKey,
    allowOwnerOffCurve = false,
  ): Promise<PublicKey> {
    return createAtaFor(usdcMint, owner, allowOwnerOffCurve);
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
    lpMint = await createMint(connection, payer, payer.publicKey, null, 0);

    poolStatePda = PublicKey.findProgramAddressSync(
      POOL_SEEDS,
      program.programId,
    )[0];
    poolAuthorityPda = PublicKey.findProgramAddressSync(
      POOL_AUTHORITY_SEEDS,
      program.programId,
    )[0];

    buyerAta = await createAta(buyer.publicKey);
    sellerAta = await createAta(seller.publicKey);
    lpAta = await createAta(lp.publicKey);
    lpTokenAta = await createAtaFor(lpMint, lp.publicKey);
    platformAta = await createAta(platformWallet.publicKey);
    poolTokenAccount = await createAta(poolAuthorityPda, true);

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
    await mintTo(
      connection,
      payer,
      lpMint,
      lpTokenAta,
      payer.publicKey,
      100_000,
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
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([lp])
      .rpc();

    const poolState = await program.account.poolState.fetch(poolStatePda);
    assert.equal(poolState.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(poolState.totalAssets.toString(), USDC(100_000).toString());
    assert.equal(poolState.nav.toString(), USDC(1).toString());
    console.log("Pool admin:", poolState.admin.toBase58());
    console.log("Pool totalAssets:", poolState.totalAssets.toString());
    console.log("Pool nav:", poolState.nav.toString());
  });

  it("Creates a trade deal", async () => {
    const tradeId = new anchor.BN(1);
    const amount = new anchor.BN(USDC(1_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    await program.methods
      .createDeal(tradeId, seller.publicKey, amount, tenorDays)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        dealTokenAccount,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    assert.equal(dealState.status, 0); // Pending
    assert.equal(dealState.buyer.toBase58(), buyer.publicKey.toBase58());
    assert.equal(dealState.seller.toBase58(), seller.publicKey.toBase58());
    assert.equal(dealState.downPayment.toString(), USDC(300).toString());
    assert.equal(dealState.poolPortion.toString(), USDC(700).toString());
    assert.equal(dealState.tenor.toString(), (30 * 86_400).toString());
    const escrowAfterCreate = await getAccount(connection, dealTokenAccount);
    assert.equal(escrowAfterCreate.amount, BigInt(USDC(300)));
    console.log("Deal PDA:", deal.toBase58());
    console.log("Deal status:", dealState.status);
  });

  it("Attests trade documents on chain", async () => {
    const tradeId = new anchor.BN(1);
    const fileHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const uri = "ipfs://bafybeig7/export-invoice-trade-1.pdf";
    const doc = documentPda(tradeId, fileHash);

    await program.methods
      .attestDocument(tradeId, fileHash, uri)
      .accounts({
        owner: buyer.publicKey,
        document: doc,
        deal: dealPda(buyer.publicKey, tradeId),
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const record = await program.account.documentRecord.fetch(doc);
    assert.equal(record.tradeId.toString(), tradeId.toString());
    assert.equal(record.owner.toBase58(), buyer.publicKey.toBase58());
    assert.deepEqual([...record.fileHash], [...fileHash]);
    assert.equal(record.uri, uri);
    assert.ok(record.uploadedAt.gt(new anchor.BN(0)));

    const standaloneHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const standaloneUri = "ipfs://bafybeig7/standalone-bill-of-lading.pdf";
    const standaloneDoc = documentPda(new anchor.BN(0), standaloneHash);
    await program.methods
      .attestDocument(new anchor.BN(0), standaloneHash, standaloneUri)
      .accounts({
        owner: buyer.publicKey,
        document: standaloneDoc,
        deal: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    const standalone = await program.account.documentRecord.fetch(standaloneDoc);
    assert.equal(standalone.tradeId.toString(), "0");
    assert.equal(standalone.uri, standaloneUri);
    console.log("Document PDA:", doc.toBase58());
    console.log("Document URI:", record.uri);
    console.log("Document uploadedAt:", record.uploadedAt.toString());
    console.log("Standalone document PDA:", standaloneDoc.toBase58());
  });

  it("Funds a deal", async () => {
    const tradeId = new anchor.BN(1);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    await program.methods
      .fundDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    assert.equal(dealState.status, 1); // Funded
    assert.equal(poolState.activeCapital.toString(), USDC(700).toString());
    assert.equal(poolState.totalAssets.toString(), USDC(100_300).toString());
    assert.equal(poolState.nav.toString(), USDC(1).toString());
    const poolVaultAfterFund = await getAccount(connection, poolTokenAccount);
    const escrowAfterFund = await getAccount(connection, dealTokenAccount);
    assert.equal(poolVaultAfterFund.amount, BigInt(USDC(100_000 - 700)));
    assert.equal(escrowAfterFund.amount, BigInt(USDC(1_000)));
    console.log("Active capital:", poolState.activeCapital.toString());
    console.log("Total assets:", poolState.totalAssets.toString());
  });

  it("Repays and distributes fees", async () => {
    const tradeId = new anchor.BN(1);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    // 物流状态推进：Funded -> InTransit -> CustomsClear -> Delivered
    for (const target of [2, 3, 4]) {
      await program.methods
        .advanceDeal(tradeId, target)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: buyer.publicKey,
          deal,
        })
        .signers([admin])
        .rpc();
    }
    let dealState = await program.account.tradeDeal.fetch(deal);
    assert.equal(dealState.status, 4); // Delivered

    // 交付确认后释放托管资金给卖方，订单进入还款期
    await program.methods
      .releaseToSeller(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        buyer: buyer.publicKey,
        deal,
        dealTokenAccount,
        sellerTokenAccount: sellerAta,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    dealState = await program.account.tradeDeal.fetch(deal);
    assert.equal(dealState.status, 5); // Repaying
    const sellerBalance = await getAccount(connection, sellerAta);
    assert.equal(sellerBalance.amount, BigInt(USDC(1_000)));

    await program.methods
      .repayDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        platformTokenAccount: platformAta,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const platformBalance = await getAccount(connection, platformAta);
    const poolVaultAfterRepay = await getAccount(connection, poolTokenAccount);

    const fee = (USDC(1_000) * 250) / 10_000;
    const lpDividend = (fee * 4_000) / 10_000;
    const platformPart = (fee * 5_000) / 10_000;

    assert.equal(dealState.status, 6); // Settled
    assert.equal(poolState.pendingDividends.toString(), lpDividend.toString());
    assert.equal(platformBalance.amount, BigInt(platformPart));
    assert.equal(poolState.activeCapital.toString(), "0");
    assert.equal(poolState.nav.toString(), USDC(1).toString());
    assert.equal(poolVaultAfterRepay.amount, BigInt(USDC(100_000)));
    console.log("Pending dividends:", poolState.pendingDividends.toString());
    console.log("Platform balance:", platformBalance.amount.toString());
  });

  it("Fails on over-concentration", async () => {
    const tradeId = new anchor.BN(3);
    const amount = new anchor.BN(USDC(20_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    let failed = false;
    try {
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, tenorDays)
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal,
          buyerTokenAccount: buyerAta,
          dealTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (error) {
      failed = true;
      console.log("Over-concentration error:", String(error));
      assert.ok(String(error).includes("OverConcentration"));
    }
    assert.ok(failed, "expected OverConcentration error");
  });

  it("Handles default scenario", async () => {
    const tradeId = new anchor.BN(4);
    const amount = new anchor.BN(USDC(1_000));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    await program.methods
      .createDeal(tradeId, seller.publicKey, amount, tenorDays)
      .accounts({
        poolState: poolStatePda,
        buyer: buyer.publicKey,
        deal,
        buyerTokenAccount: buyerAta,
        dealTokenAccount,
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
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

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
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const poolAfter = await getAccount(connection, poolTokenAccount);
    const dealAfter = await getAccount(connection, dealTokenAccount);

    assert.equal(dealState.status, 7); // Defaulted
    assert.equal(
      poolAfter.amount,
      poolBefore.amount + BigInt(USDC(300)) - BigInt(insurancePayout),
    );
    assert.equal(
      dealAfter.amount,
      BigInt(USDC(700)) + BigInt(insurancePayout),
    );
    assert.equal(
      poolState.insuranceFund.toString(),
      new anchor.BN(poolStateBefore.insuranceFund)
        .sub(new anchor.BN(insurancePayout))
        .toString(),
    );
    console.log("Default status:", dealState.status);
    console.log("Insurance fund:", poolState.insuranceFund.toString());
  });

  it("Redeems LP tokens and enforces redemption limits", async () => {
    const redeemAccounts = {
      poolState: poolStatePda,
      lpUser: lp.publicKey,
      lpUserTokenAccount: lpTokenAta,
      lpUserUsdcTokenAccount: lpAta,
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
      usdcMint,
      lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    const lpMintInfo = await getMint(connection, lpMint);
    const poolToken = await getAccount(connection, poolTokenAccount);
    const poolBefore = await program.account.poolState.fetch(poolStatePda);
    const lpTokenBefore = await getAccount(connection, lpTokenAta);
    const usdcBefore = await getAccount(connection, lpAta);

    const lpAmount = new anchor.BN(5_000);
    const usdcOut = lpAmount
      .mul(new anchor.BN(poolToken.amount.toString()))
      .div(new anchor.BN(lpMintInfo.supply.toString()));

    await program.methods
      .redeemLp(lpAmount)
      .accounts(redeemAccounts)
      .signers([lp])
      .rpc();

    const poolAfter = await program.account.poolState.fetch(poolStatePda);
    const lpTokenAfter = await getAccount(connection, lpTokenAta);
    const usdcAfter = await getAccount(connection, lpAta);

    assert.equal(
      lpTokenAfter.amount,
      lpTokenBefore.amount - BigInt(lpAmount.toString()),
    );
    assert.equal(
      usdcAfter.amount,
      usdcBefore.amount + BigInt(usdcOut.toString()),
    );
    assert.equal(
      poolAfter.totalAssets.toString(),
      poolBefore.totalAssets.sub(usdcOut).toString(),
    );
    console.log("Redeemed LP:", lpAmount.toString(), "for USDC:", usdcOut.toString());

    await assert.rejects(
      program.methods
        .redeemLp(new anchor.BN(90_000))
        .accounts(redeemAccounts)
        .signers([lp])
        .rpc(),
      /MaxRedeemExceeded|Redeem exceeds/,
    );
    await assert.rejects(
      program.methods
        .redeemLp(new anchor.BN(0))
        .accounts(redeemAccounts)
        .signers([lp])
        .rpc(),
      /ZeroRedeemAmount|Redeem amount/,
    );
  });
});
