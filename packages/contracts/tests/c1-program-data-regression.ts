import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import { createMint } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

// 独立审计 C-1（Critical）：initialize_pool / initialize_registry 的 program_data
// 必须绑定本程序真实 ProgramData PDA（address + owner == BPF Loader）。
// 攻击者若传入任意账户（普通签名账户 / 非本程序 ProgramData）伪造 upgrade authority，
// 即可抢跑初始化夺取管理员 —— 本文件验证伪造一律被拒（Unauthorized）。
// 文件名按 c1 排序，先于主生命周期测试运行（此时 Pool/Registry PDA 尚未初始化，
// 且 anchor test 对每个测试文件使用独立 validator，不会与主测试互相污染）。
describe("C-1 forged program_data regression (independent audit)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

  function programDataPda(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
  }

  async function airdrop(pubkey: PublicKey): Promise<void> {
    const sig = await connection.requestAirdrop(pubkey, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  it("trade-finance: rejects initialize_pool with forged program_data", async () => {
    const program: any = anchor.workspace.TradeFinance;
    const payer = anchor.web3.Keypair.generate();
    const attacker = anchor.web3.Keypair.generate();
    await Promise.all([airdrop(payer.publicKey), airdrop(attacker.publicKey)]);

    const usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);
    const lpMint = await createMint(connection, payer, payer.publicKey, null, 6);
    const poolStatePda = PublicKey.findProgramAddressSync(
      [Buffer.from("trade_finance"), Buffer.from("pool")],
      program.programId,
    )[0];
    const poolAuthorityPda = PublicKey.findProgramAddressSync(
      [Buffer.from("trade_finance"), Buffer.from("pool_usdc")],
      program.programId,
    )[0];
    // 正样本：本程序真实 ProgramData PDA（仅对照，非本次断言目标）
    const realPda = programDataPda(program.programId);
    assert.notEqual(realPda.toBase58(), SystemProgram.programId.toBase58());

    // 伪造：普通签名账户地址（既非本程序 ProgramData PDA，也非 BPF Loader 拥有）
    const forged = anchor.web3.Keypair.generate();
    await airdrop(forged.publicKey);

    await assert.rejects(
      program.methods
        .initializePool(attacker.publicKey, new anchor.BN(1))
        .accounts({
          poolState: poolStatePda,
          admin: attacker.publicKey,
          usdcMint,
          lpMint,
          poolAuthority: poolAuthorityPda,
          programData: forged.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc(),
      /Unauthorized/i,
      "C-1: forged program_data must be rejected",
    );
  });

  it("supply-chain: rejects initialize_registry with forged program_data", async () => {
    const program: any = anchor.workspace.SupplyChain;
    const attacker = anchor.web3.Keypair.generate();
    await airdrop(attacker.publicKey);

    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("supply_chain"), Buffer.from("registry")],
      program.programId,
    )[0];

    // 伪造：普通签名账户地址
    const forged = anchor.web3.Keypair.generate();
    await airdrop(forged.publicKey);

    await assert.rejects(
      program.methods
        .initializeRegistry(new anchor.BN(1))
        .accounts({
          registry: registryPda,
          admin: attacker.publicKey,
          programData: forged.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc(),
      /Unauthorized/i,
      "C-1: forged program_data must be rejected",
    );
  });
});
