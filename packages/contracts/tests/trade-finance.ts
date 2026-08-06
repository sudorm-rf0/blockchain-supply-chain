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

  // ---- 不变量辅助：total_assets == vault + 全部订单托管余额 ----
  async function poolSnapshot() {
    return program.account.poolState.fetch(poolStatePda);
  }
  async function vaultBalance(): Promise<bigint> {
    return (await getAccount(connection, poolTokenAccount)).amount;
  }
  async function escrowBalance(escrow: PublicKey): Promise<bigint> {
    if (!(await connection.getAccountInfo(escrow))) return 0n;
    return (await getAccount(connection, escrow)).amount;
  }
  // 扫描该测试文件创建的全部订单托管（buyer 为所有订单买方，tradeId 1..200）
  async function allKnownEscrowSum(): Promise<bigint> {
    let sum = 0n;
    for (let id = 1; id <= 200; id++) {
      const deal = dealPda(buyer.publicKey, new anchor.BN(id));
      const escrow = getAssociatedTokenAddressSync(
        usdcMint,
        deal,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      if (await connection.getAccountInfo(escrow)) {
        sum += (await getAccount(connection, escrow)).amount;
      }
    }
    return sum;
  }

  async function assertPoolInvariant(label: string): Promise<void> {
    const pool = await poolSnapshot();
    const vault = await vaultBalance();
    const escrowSum = await allKnownEscrowSum();
    assert.equal(
      pool.totalAssets.toString(),
      (vault + escrowSum).toString(),
      `${label}: total_assets(${pool.totalAssets}) 应等于 vault(${vault}) + 托管(${escrowSum})`,
    );
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

  function rebatePda(buyerKey: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_finance"),
        Buffer.from("rebate"),
        buyerKey.toBuffer(),
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
        usdcMint,
        lpMint,
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

  it("Rejects re-initializing the pool", async () => {
    await assert.rejects(
      program.methods
        .initializePool(platformWallet.publicKey)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          usdcMint,
          lpMint,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc(),
      /already in use|AccountDiscriminator|ConstraintSeeds/i,
    );
    console.log("Pool re-initialization rejected");
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
    await assertPoolInvariant("fund");
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
        rebate: rebatePda(buyer.publicKey),
        systemProgram: SystemProgram.programId,
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
    const buyerRebate = (fee * 1_000) / 10_000;

    assert.equal(dealState.status, 6); // Settled
    assert.equal(poolState.pendingDividends.toString(), lpDividend.toString());
    assert.equal(platformBalance.amount, BigInt(platformPart));
    assert.equal(poolState.activeCapital.toString(), "0");
    assert.equal(poolState.nav.toString(), "1000100");
    assert.equal(poolVaultAfterRepay.amount, BigInt(USDC(100_010)));
    assert.equal(poolState.totalAssets.toString(), USDC(100_010).toString());
    const rebateAfter = await program.account.rebateRecord.fetch(
      rebatePda(buyer.publicKey),
    );
    assert.equal(rebateAfter.totalRebate.toString(), buyerRebate.toString());
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

  it("Distributes pending LP dividends", async () => {
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const pending = new anchor.BN(poolState.pendingDividends.toString());
    assert.ok(pending.gt(new anchor.BN(0)), "expected pending dividends");

    const usdcBefore = await getAccount(connection, lpAta);
    const vaultBefore = await getAccount(connection, poolTokenAccount);
    await program.methods
      .distributeDividends(pending)
      .accounts({
        poolState: poolStatePda,
        admin: admin.publicKey,
        recipient: lp.publicKey,
        recipientTokenAccount: lpAta,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const poolAfter = await program.account.poolState.fetch(poolStatePda);
    const usdcAfter = await getAccount(connection, lpAta);
    const vaultAfter = await getAccount(connection, poolTokenAccount);
    assert.equal(poolAfter.pendingDividends.toString(), "0");
    assert.equal(
      usdcAfter.amount,
      usdcBefore.amount + BigInt(pending.toString()),
    );
    assert.equal(
      vaultAfter.amount,
      vaultBefore.amount - BigInt(pending.toString()),
    );
    console.log("Distributed dividends:", pending.toString());
  });

  it("Rejects dividend distribution above pending", async () => {
    const poolState = await program.account.poolState.fetch(poolStatePda);
    const pending = new anchor.BN(poolState.pendingDividends.toString());

    await assert.rejects(
      program.methods
        .distributeDividends(pending.add(new anchor.BN(1)))
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          recipient: lp.publicKey,
          recipientTokenAccount: lpAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
      /InsufficientDividends/,
    );
    console.log("Over-distribution rejected");
  });

  it("Rejects duplicate document attestation", async () => {
    const fileHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const uri = "ipfs://bafybeig7/duplicate-doc.pdf";
    const doc = documentPda(new anchor.BN(0), fileHash);
    await program.methods
      .attestDocument(new anchor.BN(0), fileHash, uri)
      .accounts({
        owner: buyer.publicKey,
        document: doc,
        deal: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    await assert.rejects(
      program.methods
        .attestDocument(new anchor.BN(0), fileHash, uri)
        .accounts({
          owner: buyer.publicKey,
          document: doc,
          deal: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
      /already in use|AccountDiscriminator|ConstraintSeeds/i,
    );
    console.log("Duplicate document attestation rejected");
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

    await assertPoolInvariant("default");
    assert.equal(dealState.status, 7); // Defaulted
    assert.equal(
      poolAfter.amount,
      poolBefore.amount + BigInt(USDC(1_000)),
    );
    assert.equal(dealAfter.amount, BigInt(0));
    assert.equal(
      poolState.insuranceFund.toString(),
      poolStateBefore.insuranceFund.toString(),
    );
    assert.equal(
      poolState.totalAssets.toString(),
      poolStateBefore.totalAssets.toString(),
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

  describe("boundary scenarios", () => {
    const CREATE_ACCOUNTS = (deal: PublicKey, dealTokenAccount: PublicKey) => ({
      poolState: poolStatePda,
      buyer: buyer.publicKey,
      deal,
      buyerTokenAccount: buyerAta,
      dealTokenAccount,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

    let edgeBuyer: anchor.web3.Keypair;
    let edgeBuyerAta: PublicKey;
    before(async () => {
      edgeBuyer = anchor.web3.Keypair.generate();
      await airdrop(edgeBuyer.publicKey);
      edgeBuyerAta = await createAta(edgeBuyer.publicKey);
      await mintTo(
        connection,
        payer,
        usdcMint,
        edgeBuyerAta,
        payer.publicKey,
        USDC(10_000),
      );
    });

    const EDGE_CREATE = (deal: PublicKey, dealTokenAccount: PublicKey) => ({
      poolState: poolStatePda,
      buyer: edgeBuyer.publicKey,
      deal,
      buyerTokenAccount: edgeBuyerAta,
      dealTokenAccount,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

    const FUND_ACCOUNTS = (deal: PublicKey, dealTokenAccount: PublicKey) => ({
      poolState: poolStatePda,
      admin: admin.publicKey,
      buyer: edgeBuyer.publicKey,
      deal,
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
      dealTokenAccount,
      usdcMint,
      lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    const REPAY_ACCOUNTS = (
      deal: PublicKey,
      repayer: PublicKey,
      repayerTokenAccount: PublicKey,
    ) => ({
      poolState: poolStatePda,
      buyer: repayer,
      deal,
      buyerTokenAccount: repayerTokenAccount,
      platformTokenAccount: platformAta,
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
      usdcMint,
      lpMint,
      rebate: rebatePda(repayer),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    it("Rejects funding an already funded deal", async () => {
      const tradeId = new anchor.BN(14);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .fundDeal(tradeId)
          .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
          .signers([admin])
          .rpc(),
        /DealNotPending/,
      );
      console.log("Double funding rejected");
    });

    it("Rejects repaying a deal that is not in Repaying", async () => {
      const tradeId = new anchor.BN(15);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .repayDeal(tradeId)
          .accounts(REPAY_ACCOUNTS(deal, edgeBuyer.publicKey, edgeBuyerAta))
          .signers([edgeBuyer])
          .rpc(),
        /DealNotRepaying/,
      );
      console.log("Repay before release rejected");
    });

    it("Rejects duplicate repayment after settlement", async () => {
      const tradeId = new anchor.BN(1);
      const deal = dealPda(buyer.publicKey, tradeId);
      await assert.rejects(
        program.methods
          .repayDeal(tradeId)
          .accounts(REPAY_ACCOUNTS(deal, buyer.publicKey, buyerAta))
          .signers([buyer])
          .rpc(),
        /DealNotRepaying/,
      );
      console.log("Duplicate repayment rejected");
    });

    it("Rejects skipping logistics states", async () => {
      const tradeId = new anchor.BN(16);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .advanceDeal(tradeId, 4)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
          .signers([admin])
          .rpc(),
        /InvalidStateTransition/,
      );
      console.log("Skipped logistics state rejected");
    });

    it("Rejects defaulting a Pending deal", async () => {
      const tradeId = new anchor.BN(17);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await assert.rejects(
        program.methods
          .defaultDeal(tradeId)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            dealTokenAccount,
            usdcMint,
            lpMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
        /InvalidStateTransition/,
      );
      console.log("Default on Pending rejected");
    });

    it("Rejects defaulting a REPAYING deal before tenor expiry", async () => {
      const tradeId = new anchor.BN(27);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
          .signers([admin])
          .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: edgeBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      await assert.rejects(
        program.methods
          .defaultDeal(tradeId)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            dealTokenAccount,
            usdcMint,
            lpMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
        /DealNotExpired/,
      );
      console.log("Default on unexpired REPAYING deal rejected");
    });

    it("Rejects repayment when the buyer account is not the deal buyer", async () => {
      const tradeId = new anchor.BN(18);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
          .signers([admin])
          .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: edgeBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .repayDeal(tradeId)
          .accounts(REPAY_ACCOUNTS(deal, seller.publicKey, sellerAta))
          .signers([seller])
          .rpc(),
        /Unauthorized|ConstraintSeeds/,
      );
      console.log("Repayment by wrong buyer account rejected");
    });

    it("Rejects repayment when the buyer has insufficient funds", async () => {
      const cashBuyer = anchor.web3.Keypair.generate();
      await airdrop(cashBuyer.publicKey);
      const cashAta = await createAta(cashBuyer.publicKey);
      await mintTo(
        connection,
        payer,
        usdcMint,
        cashAta,
        payer.publicKey,
        USDC(400),
      );

      const tradeId = new anchor.BN(19);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(cashBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts({
          poolState: poolStatePda,
          buyer: cashBuyer.publicKey,
          deal,
          buyerTokenAccount: cashAta,
          dealTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([cashBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: cashBuyer.publicKey,
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
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: cashBuyer.publicKey,
            deal,
          })
          .signers([admin])
          .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: admin.publicKey,
          buyer: cashBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      await assert.rejects(
        program.methods
          .repayDeal(tradeId)
          .accounts(REPAY_ACCOUNTS(deal, cashBuyer.publicKey, cashAta))
          .signers([cashBuyer])
          .rpc(),
        /InsufficientFunds/,
      );
      console.log("Repayment with insufficient funds rejected");
    });

    it("Rejects advancing by a non-admin", async () => {
      const tradeId = new anchor.BN(20);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .advanceDeal(tradeId, 2)
          .accounts({
            poolState: poolStatePda,
            admin: edgeBuyer.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
          .signers([edgeBuyer])
          .rpc(),
        /Unauthorized/,
      );
      console.log("Advance by non-admin rejected");
    });

    it("Rejects invalid tenor", async () => {
      const tradeId = new anchor.BN(10);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(buyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await assert.rejects(
        program.methods
          .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(45))
          .accounts(CREATE_ACCOUNTS(deal, dealTokenAccount))
          .signers([buyer])
          .rpc(),
        /InvalidTenor/,
      );
      console.log("Invalid tenor rejected");
    });

    it("Rejects zero amount", async () => {
      const tradeId = new anchor.BN(11);
      const deal = dealPda(buyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await assert.rejects(
        program.methods
          .createDeal(tradeId, seller.publicKey, new anchor.BN(0), new anchor.BN(30))
          .accounts(CREATE_ACCOUNTS(deal, dealTokenAccount))
          .signers([buyer])
          .rpc(),
        /InvalidAmount|greater than zero/,
      );
      console.log("Zero amount rejected");
    });

    it("Rejects a buyer with insufficient down payment", async () => {
      const poorBuyer = anchor.web3.Keypair.generate();
      await airdrop(poorBuyer.publicKey);
      const poorAta = await createAta(poorBuyer.publicKey);
      await mintTo(
        connection,
        payer,
        usdcMint,
        poorAta,
        payer.publicKey,
        USDC(100),
      );

      const tradeId = new anchor.BN(12);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(poorBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await assert.rejects(
        program.methods
          .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
          .accounts({
            poolState: poolStatePda,
            buyer: poorBuyer.publicKey,
            deal,
            buyerTokenAccount: poorAta,
            dealTokenAccount,
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([poorBuyer])
          .rpc(),
        /InsufficientFunds|Insufficient funds/,
      );
      console.log("Insufficient down payment rejected");
    });

    it("Rejects a non-admin funder", async () => {
      const tradeId = new anchor.BN(13);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(buyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(CREATE_ACCOUNTS(deal, dealTokenAccount))
        .signers([buyer])
        .rpc();

      await assert.rejects(
        program.methods
          .fundDeal(tradeId)
          .accounts({
            poolState: poolStatePda,
            admin: buyer.publicKey,
            buyer: buyer.publicKey,
            deal,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            dealTokenAccount,
            usdcMint,
            lpMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc(),
        /Unauthorized/,
      );
      console.log("Non-admin funder rejected");
    });

    it("Rejects invalid state transition from Settled", async () => {
      const tradeId = new anchor.BN(1);
      const deal = dealPda(buyer.publicKey, tradeId);
      await assert.rejects(
        program.methods
          .advanceDeal(tradeId, 2)
          .accounts({
            poolState: poolStatePda,
            admin: admin.publicKey,
            buyer: buyer.publicKey,
            deal,
          })
          .signers([admin])
          .rpc(),
        /InvalidStateTransition|Invalid state transition/,
      );
      console.log("Invalid state transition rejected");
    });

    it("Rejects duplicate deal id", async () => {
      const tradeId = new anchor.BN(1);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(buyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      let failed = false;
      try {
        await program.methods
          .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
          .accounts(CREATE_ACCOUNTS(deal, dealTokenAccount))
          .signers([buyer])
          .rpc();
      } catch (error) {
        failed = true;
        console.log("Duplicate deal error:", String(error));
        assert.ok(
          /already in use|seeds constraint|Account|constraint/i.test(String(error)),
        );
      }
      assert.ok(failed, "expected duplicate deal creation to fail");
    });

    it("Rejects funding with a mismatched USDC mint", async () => {
      const tradeId = new anchor.BN(28);
      const amount = new anchor.BN(USDC(1_000));
      const deal = dealPda(edgeBuyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      await program.methods
        .createDeal(tradeId, seller.publicKey, amount, new anchor.BN(30))
        .accounts(EDGE_CREATE(deal, dealTokenAccount))
        .signers([edgeBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
        .signers([admin])
        .rpc();
      // 复用链上已有的 lpMint 作为“不匹配的 USDC mint”：pool_token_account.mint
      // (真实 USDC) != usdc_mint.key() (lpMint)，Anchor 在指令体执行前即拒绝。
      await assert.rejects(
        program.methods
          .fundDeal(tradeId)
          .accounts({
            ...FUND_ACCOUNTS(deal, dealTokenAccount),
            usdcMint: lpMint,
          })
          .signers([admin])
          .rpc(),
        /ConstraintMint|mint/i,
      );
    });

    it("Rejects redeeming LP with a mismatched LP mint", async () => {
      await assert.rejects(
        program.methods
          .redeemLp(new anchor.BN(1))
          .accounts({
            poolState: poolStatePda,
            lpUser: lp.publicKey,
            lpUserTokenAccount: lpTokenAta,
            lpUserUsdcTokenAccount: lpAta,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            usdcMint,
            lpMint: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([lp])
          .rpc(),
        /ConstraintMint|mint/i,
      );
    });

  it("Accounting deltas hold through create/fund/default (audit H2/H4)", async () => {
    // 增量断言：验证 create 只增 down_payment、fund 为内部划转、default 托管整笔回池
    const tradeId = new anchor.BN(99);
    const amount = new anchor.BN(USDC(100));
    const tenorDays = new anchor.BN(30);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    await mintTo(
      connection,
      payer,
      usdcMint,
      buyerAta,
      payer.publicKey,
      USDC(500),
    );

    const totalBefore = (await poolSnapshot()).totalAssets;
    const vaultBefore = await vaultBalance();
    const escrowBefore = await escrowBalance(dealTokenAccount);

    // create：首付 30 进托管；total_assets 只增加 down_payment（H4），vault 不变
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
    assert.equal(
      (await escrowBalance(dealTokenAccount)) - escrowBefore,
      BigInt(USDC(30)),
      "create 后托管应增加首付 30",
    );
    assert.equal(
      ((await poolSnapshot()).totalAssets - totalBefore).toString(),
      BigInt(USDC(30)).toString(),
      "create 只增加 total_assets 30（H4）",
    );
    assert.equal(await vaultBalance(), vaultBefore, "create 不应动 vault");

    // fund：vault -> 托管 70，total_assets 不变（H4 内部划转）
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
    assert.equal(
      (await escrowBalance(dealTokenAccount)) - escrowBefore,
      BigInt(USDC(100)),
      "fund 后托管应达 100",
    );
    assert.equal(
      ((await poolSnapshot()).totalAssets - totalBefore).toString(),
      BigInt(USDC(30)).toString(),
      "fund 不应改变 total_assets（H4）",
    );
    assert.equal(
      vaultBefore - (await vaultBalance()),
      BigInt(USDC(70)),
      "fund 从 vault 划转 70",
    );

    // default：托管整笔回池（H2），total_assets 不变，escrow 清零
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
    assert.equal(await escrowBalance(dealTokenAccount), 0n, "default 后托管清零");
    assert.equal(
      ((await poolSnapshot()).totalAssets - totalBefore).toString(),
      BigInt(USDC(30)).toString(),
      "default 不应改变 total_assets",
    );
    assert.equal(
      (await vaultBalance()) - vaultBefore,
      BigInt(USDC(30)),
      "default 后 vault 相对 create 前 +30（托管回到 vault）",
    );
    const defaulted = await program.account.tradeDeal.fetch(deal);
    assert.equal(defaulted.status, 7);
  });
  
  describe("governance: pause + admin rotation", () => {
    let govLp: anchor.web3.Keypair;
    let govLpAta: PublicKey;
    let govLpTokenAta: PublicKey;

    const GOV_REDEEM_ACCOUNTS = () => ({
      poolState: poolStatePda,
      lpUser: govLp.publicKey,
      lpUserTokenAccount: govLpTokenAta,
      lpUserUsdcTokenAccount: govLpAta,
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
      usdcMint,
      lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    async function setPausedAs(
      keypair: anchor.web3.Keypair,
      paused: boolean,
    ): Promise<void> {
      await program.methods
        .setPaused(paused)
        .accounts({ poolState: poolStatePda, admin: keypair.publicKey })
        .signers([keypair])
        .rpc();
    }

    before(async () => {
      // 独立 LP，避免干扰主生命周期测试的余额断言。
      govLp = anchor.web3.Keypair.generate();
      await airdrop(govLp.publicKey);
      govLpAta = await createAta(govLp.publicKey);
      govLpTokenAta = await createAtaFor(lpMint, govLp.publicKey);
      await mintTo(
        connection,
        payer,
        lpMint,
        govLpTokenAta,
        payer.publicKey,
        100_000,
      );
    });

    it("Admin can pause and unpause the pool", async () => {
      await setPausedAs(admin, true);
      assert.equal((await poolSnapshot()).paused, true);
      await setPausedAs(admin, false);
      assert.equal((await poolSnapshot()).paused, false);
      console.log("Pool pause/unpause ok");
    });

    it("Pause freezes money-moving ops and unpause resumes them", async () => {
      await setPausedAs(admin, true);
      // 暂停时赎回被冻结（与建单/放款/还款/违约/释放/分红共用同一守卫）
      await assert.rejects(
        program.methods
          .redeemLp(new anchor.BN(1_000))
          .accounts(GOV_REDEEM_ACCOUNTS())
          .signers([govLp])
          .rpc(),
        /Pool is paused/,
      );
      console.log("Redeem blocked while paused");

      await setPausedAs(admin, false);
      const lpTokenBefore = await getAccount(connection, govLpTokenAta);
      await program.methods
        .redeemLp(new anchor.BN(1_000))
        .accounts(GOV_REDEEM_ACCOUNTS())
        .signers([govLp])
        .rpc();
      const lpTokenAfter = await getAccount(connection, govLpTokenAta);
      assert.equal(
        lpTokenAfter.amount,
        lpTokenBefore.amount - BigInt(1_000),
        "恢复后赎回应正常扣减 LP",
      );
      console.log("Redeem resumes after unpause");
    });

    it("Rejects pausing by a non-admin", async () => {
      await assert.rejects(
        program.methods
          .setPaused(true)
          .accounts({ poolState: poolStatePda, admin: buyer.publicKey })
          .signers([buyer])
          .rpc(),
        /Unauthorized/,
      );
      console.log("Non-admin pause rejected");
    });

    it("Transfers admin; old admin loses control, new admin gains it", async () => {
      const newAdmin = anchor.web3.Keypair.generate();
      await airdrop(newAdmin.publicKey);

      await program.methods
        .transferAdmin(newAdmin.publicKey)
        .accounts({ poolState: poolStatePda, admin: admin.publicKey })
        .signers([admin])
        .rpc();
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        newAdmin.publicKey.toBase58(),
      );

      // 旧管理员不再有权
      await assert.rejects(
        program.methods
          .setPaused(true)
          .accounts({ poolState: poolStatePda, admin: admin.publicKey })
          .signers([admin])
          .rpc(),
        /Unauthorized/,
      );

      // 新管理员可暂停/恢复
      await setPausedAs(newAdmin, true);
      assert.equal((await poolSnapshot()).paused, true);
      await setPausedAs(newAdmin, false);

      // 转回原 admin，保持后续测试环境一致
      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({ poolState: poolStatePda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        admin.publicKey.toBase58(),
      );
      console.log("Admin rotation ok");
    });

    it("Rejects transferring admin to the default public key", async () => {
      await assert.rejects(
        program.methods
          .transferAdmin(PublicKey.default)
          .accounts({ poolState: poolStatePda, admin: admin.publicKey })
          .signers([admin])
          .rpc(),
        /InvalidNewAdmin/,
      );
      console.log("Default-pubkey admin transfer rejected");
    });

    it("Admin can update platform wallet; rejects default", async () => {
      const newWallet = anchor.web3.Keypair.generate();
      await program.methods
        .setPlatformWallet(newWallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: admin.publicKey })
        .signers([admin])
        .rpc();
      assert.equal(
        (await poolSnapshot()).platformWallet.toBase58(),
        newWallet.publicKey.toBase58(),
      );
      // 恢复原运营钱包，保持后续状态一致
      await program.methods
        .setPlatformWallet(platformWallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: admin.publicKey })
        .signers([admin])
        .rpc();
      await assert.rejects(
        program.methods
          .setPlatformWallet(PublicKey.default)
          .accounts({ poolState: poolStatePda, admin: admin.publicKey })
          .signers([admin])
          .rpc(),
        /InvalidPlatformWallet/,
      );
      console.log("Platform wallet update ok");
    });
  });
});
});
