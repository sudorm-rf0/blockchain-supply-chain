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
  transfer,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const USDC_DECIMALS = 6;
// 审计 N-01：LP 精度与 USDC 一致取 6 位（合约 LP_MINT_DECIMALS=6）。
const LP_MINT_DECIMALS = 6;
const USDC = (amount: number): number => amount * 10 ** USDC_DECIMALS;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// 审计 H-1：等待治理时锁过（轮询链上 clock 直到 now >= proposed_at + delay + 1）。
// 比固定 sleep 更稳：CI validator 时钟按 slot 推进，固定延时可能不足 1 秒。
async function waitForGovTimelock(
  program: any,
  connection: anchor.web3.Connection,
  poolState: anchor.web3.PublicKey,
): Promise<void> {
  const pool = await program.account.poolState.fetch(poolState);
  const target =
    Number(pool.pendingGovProposedAt.toString()) +
    Number(pool.pendingAdminDelaySecs.toString()) +
    1;
  for (;;) {
    const slot = await connection.getSlot();
    const now = await connection.getBlockTime(slot);
    if (now !== null && now >= target) return;
    await sleep(300);
  }
}

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
    // 审计 M-01 修正后的恒等式：total_assets = vault + 托管 + active_capital - 首损资金。
    // （H-04：平台首损资金不计入池子总资产。）
    const expected =
      vault +
      escrowSum +
      BigInt(pool.activeCapital.toString()) -
      BigInt(pool.firstLossReserve.toString());
    assert.equal(
      pool.totalAssets.toString(),
      expected.toString(),
      `${label}: total_assets(${pool.totalAssets}) 应等于 vault(${vault}) + 托管(${escrowSum}) + active(${pool.activeCapital})`,
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

  function documentPda(
    tradeId: anchor.BN,
    fileHash: Buffer,
    buyerKey: PublicKey,
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_finance"),
        Buffer.from("document"),
        buyerKey.toBuffer(),
        tradeId.toArrayLike(Buffer, "le", 8),
        fileHash,
      ],
      program.programId,
    )[0];
  }

  function dividendClaimPda(recipient: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("trade_finance"),
        Buffer.from("dividend_claim"),
        recipient.toBuffer(),
      ],
      program.programId,
    )[0];
  }

  function programDataPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
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
    buyer = anchor.web3.Keypair.generate();
    seller = anchor.web3.Keypair.generate();
    lp = anchor.web3.Keypair.generate();
    platformWallet = anchor.web3.Keypair.generate();

    await Promise.all(
      [payer, buyer, seller, lp, platformWallet].map((keypair) =>
        airdrop(keypair.publicKey),
      ),
    );

    poolStatePda = PublicKey.findProgramAddressSync(
      POOL_SEEDS,
      program.programId,
    )[0];
    poolAuthorityPda = PublicKey.findProgramAddressSync(
      POOL_AUTHORITY_SEEDS,
      program.programId,
    )[0];

    usdcMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      USDC_DECIMALS,
    );
    // 审计 C-01：LP mint authority 必须是 pool_authority PDA（链上铸币）。
    lpMint = await createMint(connection, payer, poolAuthorityPda, null, LP_MINT_DECIMALS);

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
    // 审计 C-01：LP 份额由 deposit_pool 链上铸造，不再手动 mintTo。
  });

  it("Initializes Pool State", async () => {
    await program.methods
      .initializePool(platformWallet.publicKey, new anchor.BN(1))
      .accounts({
        poolState: poolStatePda,
        admin: provider.wallet.publicKey,
        usdcMint,
        lpMint,
        poolAuthority: poolAuthorityPda,
        programData: programDataPda(),
        systemProgram: SystemProgram.programId,
      })
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
        depositorLpTokenAccount: lpTokenAta,
      })
      .signers([lp])
      .rpc();

    const poolState = await program.account.poolState.fetch(poolStatePda);
    assert.equal(poolState.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(poolState.totalAssets.toString(), USDC(100_000).toString());
    // 审计 N-01：6 位精度下 1 USDC = 1 LP，NAV 以「每 LP token」计 = 1 USDC raw（1e6）。
    assert.equal(poolState.nav.toString(), USDC(1).toString(), "NAV 应等于 1 USDC/LP");
    // 审计 C-01：存入 USDC 后链上铸造 LP（首笔 1 USDC = 1 LP）。
    const lpBalance = await getAccount(connection, lpTokenAta);
    assert.equal(
      lpBalance.amount,
      BigInt(USDC(100_000)),
      "deposit 应链上铸造 100_000 LP（6 位精度，raw=1e11）",
    );
    // 审计 N-01：6 位精度下 redemption_price 以「每 LP token」计 = 1 USDC raw（1e6）。
    assert.equal(
      poolState.redemptionPrice.toString(),
      USDC(1).toString(),
      "redemption_price 应等于 1 USDC/LP",
    );
    console.log("Pool admin:", poolState.admin.toBase58());
    console.log("Pool totalAssets:", poolState.totalAssets.toString());
    console.log("Pool nav:", poolState.nav.toString());
  });

  it("Rejects re-initializing the pool", async () => {
    await assert.rejects(
      program.methods
        .initializePool(platformWallet.publicKey, new anchor.BN(1))
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          usdcMint,
          lpMint,
          poolAuthority: poolAuthorityPda,
          programData: programDataPda(),
          systemProgram: SystemProgram.programId,
        })
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
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
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
    const doc = documentPda(tradeId, fileHash, buyer.publicKey);

    await program.methods
      .attestDocument(tradeId, fileHash, uri)
      .accounts({
        poolState: poolStatePda,
        owner: buyer.publicKey,
        buyer: buyer.publicKey,
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

    // 审计 M-06：无关联订单（deal 必选）的独立存证被拒绝。
    const standaloneHash = Buffer.from(
      anchor.web3.Keypair.generate().publicKey.toBytes(),
    );
    const standaloneUri = "ipfs://bafybeig7/standalone-bill-of-lading.pdf";
    await assert.rejects(
      program.methods
        .attestDocument(new anchor.BN(0), standaloneHash, standaloneUri)
        .accounts({
          poolState: poolStatePda,
          owner: buyer.publicKey,
          buyer: buyer.publicKey,
          document: documentPda(
            new anchor.BN(0),
            standaloneHash,
            buyer.publicKey,
          ),
          deal: dealPda(buyer.publicKey, new anchor.BN(0)),
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
      /ConstraintSeeds|AccountNotFound|AccountNotInitialized|TradeNotFound/i,
    );
    console.log("Standalone attestation rejected (M-06)");
    console.log("Document PDA:", doc.toBase58());
    console.log("Document URI:", record.uri);
    console.log("Document uploadedAt:", record.uploadedAt.toString());
  });

  it("Funds a deal", async () => {
    const tradeId = new anchor.BN(1);
    const deal = dealPda(buyer.publicKey, tradeId);
    const dealTokenAccount = await createAta(deal, true);

    await program.methods
      .fundDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const dealState = await program.account.tradeDeal.fetch(deal);
    const poolState = await program.account.poolState.fetch(poolStatePda);
    assert.equal(dealState.status, 1); // Funded
    // 审计 M-01：垫付计入 escrow_funded（在途托管），active_capital 保持 0。
    assert.equal(poolState.escrowFunded.toString(), USDC(700).toString());
    assert.equal(poolState.activeCapital.toString(), "0");
    assert.equal(poolState.totalAssets.toString(), USDC(100_300).toString());
    // 审计 N-01：6 位精度下 1 USDC = 1 LP，NAV 以「每 LP token」计 = 1 USDC raw（1e6）。
    assert.equal(poolState.nav.toString(), USDC(1).toString(), "NAV 应等于 1 USDC/LP（每 LP token）");
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
          admin: provider.wallet.publicKey,
          buyer: buyer.publicKey,
          deal,
        })
          .rpc();
    }
    let dealState = await program.account.tradeDeal.fetch(deal);
    assert.equal(dealState.status, 4); // Delivered

    // 交付确认后释放托管资金给卖方，订单进入还款期
    await program.methods
      .releaseToSeller(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        dealTokenAccount,
        sellerTokenAccount: sellerAta,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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

    // H-04：fee = P × fee_apy_bps(670) × tenor / (10000 × 365 × 86400)
    const fee =
      (BigInt(USDC(700)) * 670n * BigInt(30 * 86_400)) /
      BigInt(10_000 * 365 * 86_400);
    const lpDividend = (fee * 4000n) / 10000n;
    const platformPart = (fee * 5000n) / 10000n;
    const buyerRebate = (fee * 1000n) / 10000n;

    assert.equal(dealState.status, 6); // Settled
    assert.equal(poolState.pendingDividends.toString(), lpDividend.toString());
    assert.equal(platformBalance.amount, platformPart);
    assert.equal(poolState.activeCapital.toString(), "0");
    // H-04：vault 留存 = fee - platform - rebate（total_assets 按实际留存记账）
    const retained = fee - platformPart - buyerRebate;
    const expectedVault = BigInt(USDC(100_000)) + retained;
    assert.equal(poolVaultAfterRepay.amount, expectedVault);
    assert.equal(poolState.totalAssets.toString(), expectedVault.toString());
    // nav = (vault - first_loss + active + escrow_funded) / supply，每 LP token 计
    // 审计 N-01：nav = total * 1e6 / supply_raw = expectedVault / 100_000（100_000 LP）。
    assert.equal(
      poolState.nav.toString(),
      (expectedVault / 100_000n).toString(),
    );
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
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
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
        admin: provider.wallet.publicKey,
        recipient: lp.publicKey,
        recipientTokenAccount: lpAta,
        recipientLpTokenAccount: lpTokenAta,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        dividendClaim: dividendClaimPda(lp.publicKey),
        systemProgram: SystemProgram.programId,
      })
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
          admin: provider.wallet.publicKey,
          recipient: lp.publicKey,
          recipientTokenAccount: lpAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          dividendClaim: dividendClaimPda(lp.publicKey),
          systemProgram: SystemProgram.programId,
        })
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
    const doc = documentPda(new anchor.BN(1), fileHash, buyer.publicKey);
    const deal = dealPda(buyer.publicKey, new anchor.BN(1));
    const attestAccounts = {
      poolState: poolStatePda,
      owner: buyer.publicKey,
      buyer: buyer.publicKey,
      document: doc,
      deal,
      systemProgram: SystemProgram.programId,
    };
    await program.methods
      .attestDocument(new anchor.BN(1), fileHash, uri)
      .accounts(attestAccounts)
      .signers([buyer])
      .rpc();

    await assert.rejects(
      program.methods
        .attestDocument(new anchor.BN(1), fileHash, uri)
        .accounts(attestAccounts)
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
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .fundDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolBefore = await getAccount(connection, poolTokenAccount);
    const poolStateBefore = await program.account.poolState.fetch(poolStatePda);

    await program.methods
      .defaultDeal(tradeId)
      .accounts({
        poolState: poolStatePda,
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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

    // 审计 N-01：LP 6 位精度后 90_000 raw 仅 0.09 LP，不再超单笔 50% 上限；
    // 改为按剩余供应量 90%（> 50% 单笔上限）动态计算超限金额。
    const lpSupplyAfter = lpMintInfo.supply - BigInt(lpAmount.toString());
    const tooMuch = new anchor.BN(((lpSupplyAfter * 9n) / 10n).toString());
    await assert.rejects(
      program.methods
        .redeemLp(tooMuch)
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
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
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
      poolAuthority: poolAuthorityPda,
      poolTokenAccount,
    });

    const FUND_ACCOUNTS = (deal: PublicKey, dealTokenAccount: PublicKey) => ({
      poolState: poolStatePda,
      admin: provider.wallet.publicKey,
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
          .rpc();
      await assert.rejects(
        program.methods
          .fundDeal(tradeId)
          .accounts(FUND_ACCOUNTS(deal, dealTokenAccount))
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
          .rpc();
      await assert.rejects(
        program.methods
          .advanceDeal(tradeId, 4)
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
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
            admin: provider.wallet.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            dealTokenAccount,
            usdcMint,
            lpMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
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
          .rpc();
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
              .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          buyer: edgeBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
          .rpc();

      await assert.rejects(
        program.methods
          .defaultDeal(tradeId)
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            dealTokenAccount,
            usdcMint,
            lpMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
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
          .rpc();
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            buyer: edgeBuyer.publicKey,
            deal,
          })
              .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          buyer: edgeBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
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
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
        })
        .signers([cashBuyer])
        .rpc();
      await program.methods
        .fundDeal(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          buyer: cashBuyer.publicKey,
          deal,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          dealTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
          .rpc();
      for (const target of [2, 3, 4]) {
        await program.methods
          .advanceDeal(tradeId, target)
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            buyer: cashBuyer.publicKey,
            deal,
          })
              .rpc();
      }
      await program.methods
        .releaseToSeller(tradeId)
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          buyer: cashBuyer.publicKey,
          deal,
          dealTokenAccount,
          sellerTokenAccount: sellerAta,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
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
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
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
            admin: provider.wallet.publicKey,
            buyer: buyer.publicKey,
            deal,
          })
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
              .rpc(),
        /ConstraintMint|ConstraintAssociated|mint|associated/i,
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
        /ConstraintMint|ConstraintAssociated|mint|associated/i,
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
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
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
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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
        admin: provider.wallet.publicKey,
        buyer: buyer.publicKey,
        deal,
        poolAuthority: poolAuthorityPda,
        poolTokenAccount,
        dealTokenAccount,
        usdcMint,
        lpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
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
      paused: boolean,
      signer?: anchor.web3.Keypair,
    ): Promise<void> {
      const adminKey = signer ? signer.publicKey : provider.wallet.publicKey;
      const call = program.methods.setPaused(paused).accounts({
        poolState: poolStatePda,
        admin: adminKey,
      });
      await (signer ? call.signers([signer]).rpc() : call.rpc());
    }

    before(async () => {
      // 独立 LP，避免干扰主生命周期测试的余额断言。
      govLp = anchor.web3.Keypair.generate();
      await airdrop(govLp.publicKey);
      govLpAta = await createAta(govLp.publicKey);
      govLpTokenAta = await createAtaFor(lpMint, govLp.publicKey);
      // 审计 C-01：LP 只能通过 deposit_pool 链上铸造获得。
      await mintTo(
        connection,
        payer,
        usdcMint,
        govLpAta,
        payer.publicKey,
        USDC(10_000),
      );
      await program.methods
        .depositPool(new anchor.BN(USDC(10_000)))
        .accounts({
          poolState: poolStatePda,
          depositor: govLp.publicKey,
          depositorTokenAccount: govLpAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          depositorLpTokenAccount: govLpTokenAta,
        })
        .signers([govLp])
        .rpc();
    });

    it("Admin can pause and unpause the pool", async () => {
      await setPausedAs(true);
      assert.equal((await poolSnapshot()).paused, true);
      await setPausedAs(false);
      assert.equal((await poolSnapshot()).paused, false);
      console.log("Pool pause/unpause ok");
    });

    it("Pause freezes money-moving ops and unpause resumes them", async () => {
      await setPausedAs(true);
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

      await setPausedAs(false);
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

    it("Proposes and accepts admin transfer (two-step rotation, H-03)", async () => {
      const newAdmin = anchor.web3.Keypair.generate();
      await airdrop(newAdmin.publicKey);

      // 第一步：旧管理员提出提案
      await program.methods
        .proposeAdmin(newAdmin.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      assert.equal(
        (await poolSnapshot()).pendingAdmin.toBase58(),
        newAdmin.publicKey.toBase58(),
      );

      // 提案期间旧管理员仍有权
      await setPausedAs(true);
      await setPausedAs(false);

      // 第二步：新管理员签名接受（等待锁定期 1s 过去）
      await new Promise((r) => setTimeout(r, 1500));
      await program.methods
        .acceptAdmin()
        .accounts({ poolState: poolStatePda, newAdmin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        newAdmin.publicKey.toBase58(),
      );
      assert.equal(
        (await poolSnapshot()).pendingAdmin.toBase58(),
        PublicKey.default.toBase58(),
      );

      // 旧管理员不再有权
      await assert.rejects(
        program.methods
          .setPaused(true)
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /Unauthorized/,
      );

      // 新管理员可暂停/恢复
      await setPausedAs(true, newAdmin);
      assert.equal((await poolSnapshot()).paused, true);
      await setPausedAs(false, newAdmin);

      // 转回原 admin（provider wallet），保持后续测试环境一致
      await program.methods
        .proposeAdmin(provider.wallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();
      await new Promise((r) => setTimeout(r, 1500));
      await program.methods
        .acceptAdmin()
        .accounts({ poolState: poolStatePda, newAdmin: provider.wallet.publicKey })
        .rpc();
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        provider.wallet.publicKey.toBase58(),
      );
      console.log("Admin two-step rotation ok (H-03)");
    });

    it("Rejects proposing admin to the default public key", async () => {
      await assert.rejects(
        program.methods
          .proposeAdmin(PublicKey.default)
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidNewAdmin/,
      );
      console.log("Default-pubkey admin proposal rejected");
    });

    it("Admin can propose+execute platform wallet after timelock; rejects default (H-1)", async () => {
      const newWallet = anchor.web3.Keypair.generate();
      await program.methods
        .proposePlatformWallet(newWallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      // 治理时锁（H-1）：未过等待期 execute 必须被拒
      await assert.rejects(
        program.methods
          .executePlatformWallet()
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /GovDelayNotElapsed/,
      );
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executePlatformWallet()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      assert.equal(
        (await poolSnapshot()).platformWallet.toBase58(),
        newWallet.publicKey.toBase58(),
      );
      // 恢复原运营钱包，保持后续状态一致
      await program.methods
        .proposePlatformWallet(platformWallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executePlatformWallet()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      // default pubkey 在 propose 阶段即拒绝
      await assert.rejects(
        program.methods
          .proposePlatformWallet(PublicKey.default)
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidPlatformWallet/,
      );
      // 非 admin propose 被拒（H-1）
      const attacker = anchor.web3.Keypair.generate();
      await airdrop(attacker.publicKey);
      await assert.rejects(
        program.methods
          .proposePlatformWallet(attacker.publicKey)
          .accounts({ poolState: poolStatePda, admin: attacker.publicKey })
          .signers([attacker])
          .rpc(),
        /Unauthorized/,
      );
      console.log("Platform wallet propose/execute ok (H-1 timelock)");
    });

    it("H-1 governance timelock: cancel clears pending; empty slot rejects execute", async () => {
      const attacker = anchor.web3.Keypair.generate();
      await program.methods
        .proposePlatformWallet(attacker.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await program.methods
        .cancelPendingGovAction()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      // 清空后无提案 -> execute 被拒（GovActionNotPending）
      await assert.rejects(
        program.methods
          .executePlatformWallet()
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /GovActionNotPending/,
      );
      // 无提案时 cancel 也被拒
      await assert.rejects(
        program.methods
          .cancelPendingGovAction()
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /GovActionNotPending/,
      );
      console.log("H-1 timelock: cancel clears pending, empty slot rejected");
    });
  });
});

  describe("remediation: close_deal / set_lp_mint / redeem window (DFR L-02, M-09, M-05)", () => {
    it("Closes a settled deal and returns rent (L-02)", async () => {
      const tradeId = new anchor.BN(1);
      const deal = dealPda(buyer.publicKey, tradeId);
      const dealTokenAccount = await createAta(deal, true);
      const stateBefore = await program.account.tradeDeal.fetch(deal);
      assert.equal(stateBefore.status, 6); // Settled
      await program.methods
        .closeDeal(tradeId)
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal,
          dealTokenAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
      const info = await connection.getAccountInfo(deal);
      assert.equal(info, null, "close_deal 后订单账户应被关闭");
      console.log("Settled deal closed, rent returned (L-02)");
    });

    it("Rejects closing a non-terminal deal", async () => {
      const tradeIdPending = new anchor.BN(20);
      const dealPending = dealPda(buyer.publicKey, tradeIdPending);
      const escrow = await createAta(dealPending, true);
      await program.methods
        .createDeal(
          tradeIdPending,
          seller.publicKey,
          new anchor.BN(USDC(100)),
          new anchor.BN(30),
        )
        .accounts({
          poolState: poolStatePda,
          buyer: buyer.publicKey,
          deal: dealPending,
          buyerTokenAccount: buyerAta,
          dealTokenAccount: escrow,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
        })
        .signers([buyer])
        .rpc();
      await assert.rejects(
        program.methods
          .closeDeal(tradeIdPending)
          .accounts({
            poolState: poolStatePda,
            buyer: buyer.publicKey,
            deal: dealPending,
            dealTokenAccount: escrow,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc(),
        /InvalidStateTransition|InvalidAmount/,
      );
      console.log("Non-terminal close rejected (L-02)");
    });

    it("Rejects execute_set_lp_mint when pool is not paused (M-09 + H-1)", async () => {
      const newLpMint = await createMint(
        connection,
        payer,
        poolAuthorityPda,
        null,
        LP_MINT_DECIMALS,
      );
      // 治理时锁（H-1）：propose 成功（新 mint 非默认）
      await program.methods
        .proposeSetLpMint(newLpMint)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      // 未暂停池子 -> execute 被拒（M-09 语义移到 execute 阶段）
      await assert.rejects(
        program.methods
          .executeSetLpMint()
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            oldLpMint: lpMint,
            newLpMint,
            poolAuthority: poolAuthorityPda,
          })
          .rpc(),
        /PoolMustBePaused/,
      );
      // 清理待执行提案（execute 失败不改状态，需 cancel）
      await program.methods
        .cancelPendingGovAction()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      console.log("execute_set_lp_mint rejected when not paused (M-09 + H-1)");
    });

    it("Tracks redeem window usage (M-05)", async () => {
      const poolBefore = await poolSnapshot();
      assert.ok(
        BigInt(poolBefore.redeemWindowUsed.toString()) > 0n,
        "redeem 后 redeem_window_used 应大于 0",
      );
      console.log(
        "Redeem window used:",
        poolBefore.redeemWindowUsed.toString(),
        "(M-05)",
      );
    });

    it("Sets fee params via propose/execute and rejects invalid shares (H-04 + H-1)", async () => {
      await program.methods
        .proposeSetFeeParams(
          new anchor.BN(1000),
          new anchor.BN(4000),
          new anchor.BN(5000),
          new anchor.BN(1000),
        )
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executeSetFeeParams()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      const pool = await poolSnapshot();
      assert.equal(pool.feeApyBps.toString(), "1000");
      // 非法：分成比例之和 != 10000（propose 阶段即拒绝）
      await assert.rejects(
        program.methods
          .proposeSetFeeParams(
            new anchor.BN(1000),
            new anchor.BN(3000),
            new anchor.BN(3000),
            new anchor.BN(3000),
          )
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
          })
          .rpc(),
        /InvalidFeeParams/,
      );
      // 恢复默认（基准档 670）
      await program.methods
        .proposeSetFeeParams(
          new anchor.BN(670),
          new anchor.BN(4000),
          new anchor.BN(5000),
          new anchor.BN(1000),
        )
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executeSetFeeParams()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      assert.equal((await poolSnapshot()).feeApyBps.toString(), "670");
      console.log("set_fee_params propose/execute ok (H-04 + H-1)");
    });

    it("Deposits first-loss reserve without diluting LP equity (H-04)", async () => {
      const adminAta = await createAta(provider.wallet.publicKey);
      await mintTo(
        connection,
        payer,
        usdcMint,
        adminAta,
        payer.publicKey,
        USDC(10_000),
      );
      const before = await poolSnapshot();
      const vaultBefore = await vaultBalance();
      const totalBefore = before.totalAssets;
      const navBefore = before.nav;

      await program.methods
        .depositFirstLoss(new anchor.BN(USDC(5_000)))
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          depositorTokenAccount: adminAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const after = await poolSnapshot();
      assert.equal(
        after.firstLossReserve.toString(),
        USDC(5_000).toString(),
        "首损资金记账应增加",
      );
      assert.equal(
        after.totalAssets.toString(),
        totalBefore.toString(),
        "首损注入不应改变 total_assets",
      );
      assert.equal(after.nav.toString(), navBefore.toString(), "首损注入不应改变 NAV");
      assert.equal(
        (await vaultBalance()) - vaultBefore,
        BigInt(USDC(5_000)),
        "首损注入应增加金库现金",
      );
      console.log("deposit_first_loss ok (H-04)");
    });

    it("Withdraws first-loss via propose/execute and enforces minimum (H-04 + H-1)", async () => {
      const adminAta = await createAta(provider.wallet.publicKey);
      await program.methods
        .proposeWithdrawFirstLoss(new anchor.BN(USDC(4_900)))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executeWithdrawFirstLoss()
        .accounts({
          poolState: poolStatePda,
          admin: provider.wallet.publicKey,
          recipientTokenAccount: adminAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.equal(
        (await poolSnapshot()).firstLossReserve.toString(),
        USDC(100).toString(),
        "提取后应保留最低首损 100 USDC",
      );
      // 再提取会跌破最低余额 -> execute 被拒（FirstLossInsufficient）
      await program.methods
        .proposeWithdrawFirstLoss(new anchor.BN(1))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await assert.rejects(
        program.methods
          .executeWithdrawFirstLoss()
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            recipientTokenAccount: adminAta,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
        /FirstLossInsufficient/,
      );
      // 清理待执行提案
      await program.methods
        .cancelPendingGovAction()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      console.log("withdraw_first_loss propose/execute ok (H-04 + H-1)");
    });

    it("Paused pool blocks execute_withdraw_first_loss (L-10)", async () => {
      // 审计 L-10（supply-chain-project-evaluation 2026-08-08）：治理出金类指令
      // （首损提取）纳入 paused 紧急冻结覆盖。
      const adminAta = await createAta(provider.wallet.publicKey);
      await program.methods
        .proposeWithdrawFirstLoss(new anchor.BN(1))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .setPaused(true)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await assert.rejects(
        program.methods
          .executeWithdrawFirstLoss()
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
            recipientTokenAccount: adminAta,
            poolAuthority: poolAuthorityPda,
            poolTokenAccount,
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
        /PoolPaused/,
      );
      // 恢复 + 清理待执行提案
      await program.methods
        .setPaused(false)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await program.methods
        .cancelPendingGovAction()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      console.log("paused blocks withdraw_first_loss (L-10)");
    });

    it("Sets risk params via propose/execute (L-07/L-04 + H-1)", async () => {
      await program.methods
        .proposeSetRiskParams(new anchor.BN(50_000_000), new anchor.BN(500))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executeSetRiskParams()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      let pool = await poolSnapshot();
      assert.equal(pool.minInsuranceAbs.toString(), "50000000");
      assert.equal(pool.overdueFeeApyBps.toString(), "500");
      // 非法：罚息费率超上限（propose 阶段即拒绝）
      await assert.rejects(
        program.methods
          .proposeSetRiskParams(new anchor.BN(50_000_000), new anchor.BN(9000))
          .accounts({
            poolState: poolStatePda,
            admin: provider.wallet.publicKey,
          })
          .rpc(),
        /InvalidFeeParams/,
      );
      // 恢复默认
      await program.methods
        .proposeSetRiskParams(new anchor.BN(100_000_000), new anchor.BN(0))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      await waitForGovTimelock(program, connection, poolStatePda);
      await program.methods
        .executeSetRiskParams()
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      pool = await poolSnapshot();
      assert.equal(pool.minInsuranceAbs.toString(), "100000000");
      assert.equal(pool.overdueFeeApyBps.toString(), "0");
      console.log("set_risk_params propose/execute ok (L-07/L-04 + H-1)");
    });

    it("Mints and redeems at consistent cash price with first-loss (N-01/N-06)", async () => {
      // 当前池首损保留 100 USDC；验证新 LP 铸造价 = 赎回价 = equity_base / supply。
      const pool = await poolSnapshot();
      const fl = BigInt(pool.firstLossReserve.toString());
      const vaultBefore = await vaultBalance();
      const supplyBefore = BigInt(
        (await getMint(connection, lpMint)).supply.toString(),
      );
      const equityBefore = vaultBefore - fl;

      // 新 LP：deposit 后铸造份额按 equity_base 定价
      const newLp = anchor.web3.Keypair.generate();
      await airdrop(newLp.publicKey);
      const newLpUsdcAta = await createAta(newLp.publicKey);
      const newLpTokenAta = await createAtaFor(lpMint, newLp.publicKey);
      await mintTo(
        connection,
        payer,
        usdcMint,
        newLpUsdcAta,
        payer.publicKey,
        USDC(1_000),
      );
      const depositAmount = BigInt(USDC(1_000));
      const expectedShares = (depositAmount * supplyBefore) / equityBefore;

      await program.methods
        .depositPool(new anchor.BN(depositAmount.toString()))
        .accounts({
          poolState: poolStatePda,
          depositor: newLp.publicKey,
          depositorTokenAccount: newLpUsdcAta,
          poolAuthority: poolAuthorityPda,
          poolTokenAccount,
          usdcMint,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          depositorLpTokenAccount: newLpTokenAta,
        })
        .signers([newLp])
        .rpc();

      const lpBalance = BigInt(
        (await getAccount(connection, newLpTokenAta)).amount.toString(),
      );
      assert.ok(
        lpBalance >= expectedShares - 2n && lpBalance <= expectedShares + 2n,
        `铸造价应按 equity_base 定价：got ${lpBalance}, expected ~${expectedShares}`,
      );

      // 赎回价与铸造价一致（equity_base / supply）
      const poolAfter = await poolSnapshot();
      const vaultAfter = await vaultBalance();
      const supplyAfter = BigInt(
        (await getMint(connection, lpMint)).supply.toString(),
      );
      const equityAfter = vaultAfter - BigInt(poolAfter.firstLossReserve.toString());
      // 审计 N-01：redemption_price 以「每 LP token」计，放大 1e6（LP 6 位精度）。
      const redemptionPrice = (equityAfter * 1_000_000n) / supplyAfter;
      assert.equal(
        poolAfter.redemptionPrice.toString(),
        redemptionPrice.toString(),
        "redemption_price 应为 equity_base / supply * 1e6（每 LP token，N-01/N-06）",
      );
      console.log("Mint/redeem price consistent with first-loss (N-01/N-06)");
    });

    it("Enforces admin transfer lock (N-02/H-05)", async () => {
      // initialize 注入 1s 锁定期：锁定期内 accept 被拒，到期后成功。
      const tmpAdmin = anchor.web3.Keypair.generate();
      await airdrop(tmpAdmin.publicKey);
      await program.methods
        .proposeAdmin(tmpAdmin.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      // 锁定期内（< 1s）accept 被拒
      await assert.rejects(
        program.methods
          .acceptAdmin()
          .accounts({ poolState: poolStatePda, newAdmin: tmpAdmin.publicKey })
          .signers([tmpAdmin])
          .rpc(),
        /AdminLockNotElapsed/,
      );
      // 到期后 accept 成功
      await new Promise((r) => setTimeout(r, 1500));
      await program.methods
        .acceptAdmin()
        .accounts({ poolState: poolStatePda, newAdmin: tmpAdmin.publicKey })
        .signers([tmpAdmin])
        .rpc();
      // 转回原 admin
      await program.methods
        .proposeAdmin(provider.wallet.publicKey)
        .accounts({ poolState: poolStatePda, admin: tmpAdmin.publicKey })
        .signers([tmpAdmin])
        .rpc();
      await new Promise((r) => setTimeout(r, 1500));
      await program.methods
        .acceptAdmin()
        .accounts({ poolState: poolStatePda, newAdmin: provider.wallet.publicKey })
        .rpc();
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        provider.wallet.publicKey.toBase58(),
      );
      console.log("Admin lock enforced (N-02)");
    });

    it("Rejects lowering admin lock below hard floor (H-05)", async () => {
      // 时锁硬下限 86400s：设 0 或小值被拒
      await assert.rejects(
        program.methods
          .setAdminDelay(new anchor.BN(0))
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidFeeParams/,
      );
      await assert.rejects(
        program.methods
          .setAdminDelay(new anchor.BN(100))
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidFeeParams/,
      );
      // 设为 86400（下限）成功，恢复 1（无法恢复，测试放最后，不影响后续轮换）
      await program.methods
        .setAdminDelay(new anchor.BN(86_400))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();
      assert.equal(
        (await poolSnapshot()).pendingAdminDelaySecs.toString(),
        "86400",
      );
      console.log("set_admin_delay hard floor enforced (H-05)");
    });

    it("Blocks H-05 timelock bypass attack sequence (DFR PoC regression)", async () => {
      // 复现 DFR 提供的 PoC 攻击序列，验证修复后攻击被阻断：
      //   set_admin_delay(0) 现被硬下限拒绝，accept 无法即时成功。
      const attacker = anchor.web3.Keypair.generate();
      await airdrop(attacker.publicKey);

      // 1) 建立 48h 时锁
      await program.methods
        .setAdminDelay(new anchor.BN(172_800))
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();

      // 2) 提出将管理员转移给攻击者
      await program.methods
        .proposeAdmin(attacker.publicKey)
        .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
        .rpc();

      // 3) 未等待时锁：accept 被拒（锁定期生效）
      await assert.rejects(
        program.methods
          .acceptAdmin()
          .accounts({ poolState: poolStatePda, newAdmin: attacker.publicKey })
          .signers([attacker])
          .rpc(),
        /AdminLockNotElapsed/,
      );

      // 4) 攻击者尝试 set_admin_delay(0) 废止时锁 -> 被硬下限拒绝（H-05 修复）
      await assert.rejects(
        program.methods
          .setAdminDelay(new anchor.BN(0))
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidFeeParams/,
      );

      // 5) 攻击者尝试任何小值同样被拒
      await assert.rejects(
        program.methods
          .setAdminDelay(new anchor.BN(1))
          .accounts({ poolState: poolStatePda, admin: provider.wallet.publicKey })
          .rpc(),
        /InvalidFeeParams/,
      );

      // 6) 攻击路径被阻断：管理员仍是原 admin，攻击者未接管
      assert.equal(
        (await poolSnapshot()).admin.toBase58(),
        provider.wallet.publicKey.toBase58(),
        "H-05 修复后攻击者不应接管管理员",
      );
      assert.equal(
        (await poolSnapshot()).pendingAdminDelaySecs.toString(),
        "172800",
        "时锁保持 48h，未被下调",
      );
      console.log("H-05 PoC attack sequence blocked (regression)");
    });

    it("External vault donations cannot manipulate pricing (H-3 regression)", async () => {
      // 独立复测 H-3：直接向金库 ATA 捐赠（绕过 deposit_pool）。定价基于权威
      // tracked_vault，捐赠不进入定价基准；存取不被锁定（无施害 DoS），
      // 捐赠成为不可申领的协议盈余（redeem 不会兑付它）。
      const donor = anchor.web3.Keypair.generate();
      await airdrop(donor.publicKey);
      const donorAta = await createAta(donor.publicKey);
      await mintTo(connection, payer, usdcMint, donorAta, payer.publicKey, USDC(1_000));
      const vaultBefore = await vaultBalance();
      await transfer(
        connection,
        donor,
        donorAta,
        poolTokenAccount,
        donor.publicKey,
        USDC(1_000),
      );
      const vaultAfterDonation = await vaultBalance();
      assert.equal(
        vaultAfterDonation,
        vaultBefore + BigInt(USDC(1_000)),
        "donation should reach the vault",
      );

      // 捐赠后存取仍可用（不锁死），且赎回只按权威记账兑付——捐赠留在金库不可申领。
      const lpSupplyBefore = (await getMint(connection, lpMint)).supply;
      // 审计 N-01：6 位精度下赎回 1 LP（1e6 raw）——1 raw 会因 equity/supply<1 取整为 0（ZeroRedeemAmount）。
      await program.methods
        .redeemLp(new anchor.BN(1_000_000))
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
        .rpc();
      // 赎回后金库仍应保留捐赠（未申领），且 LP 供应减少 1。
      const vaultAfterRedeem = await vaultBalance();
      assert.ok(
        vaultAfterRedeem >= vaultAfterDonation - BigInt(USDC(1_000)) &&
          vaultAfterRedeem < vaultAfterDonation,
        "redeem 只兑付权威记账部分，捐赠应保留在 vault 中不可申领",
      );
      const lpSupplyAfter = (await getMint(connection, lpMint)).supply;
      assert.equal(lpSupplyAfter, lpSupplyBefore - 1_000_000n, "LP 供应应减少 1 LP（1e6 raw）");
      console.log("External donation is inert surplus, cannot manipulate pricing (H-3 regression)");
    });
  });
});

