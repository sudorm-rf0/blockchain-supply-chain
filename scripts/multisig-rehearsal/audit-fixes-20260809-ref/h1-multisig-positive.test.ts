/**
 * H-1 真实 VaultTransaction 正路径测试（supply-chain）。
 *
 * 目的：证明 Squads v4 多签执行合约 admin 指令时，vault PDA 作为签名者被合约接受、
 *       指令成功执行（而非仅"单签被拒"）。这是 H-1 真正根治的必要证据 —— 当前
 *       supply-chain.ts 仅用 fakeMultisig 验证负向，从不验证正路径，若集成有微妙
 *       错误导致 multisig 配置后合约永久 brick，该测试抓不到。
 *
 * 依赖：@sqds/multisig（v4）、@coral-xyz/anchor、@solana/web3.js。
 * 运行：devnet；须先 anchor build 生成 IDL，并部署/初始化 supply-chain（单管理员阶段）。
 *
 * 重要：本文件为脚手架，@sqds/multisig 的 VaultTransaction 创建/approve/execute 导入路径
 *       随 SDK 版本可能变化；上线前须在 devnet 对照实际安装版本校验 API 并跑通。
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getMultisigPda,
  getVaultPda,
  getVaultTransactionPda,
} from "@sqds/multisig/lib/pdas";
import { InstructionData, VaultTransaction } from "@sqds/multisig/lib/types";
import {
  createMultisig,
  createVaultTransaction,
  approveVaultTransaction,
  executeVaultTransaction,
  addInstructionToVaultTransaction,
} from "@sqds/multisig/lib/instructions";

describe("H-1 positive path: real Squads VaultTransaction authorizes contract", () => {
  const provider = anchor.getProvider() as AnchorProvider;
  const program = anchor.workspace.SupplyChain as Program;

  // 真实 Squads 多签的成员（测试用，3-of-N 取 3 票）
  const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  let multisigPda: PublicKey;
  let vaultPda: PublicKey;
  let vaultTxPda: PublicKey;
  let txIndex: number;

  const REGISTRY = () =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("supply_chain"), Buffer.from("registry")],
      program.programId,
    )[0];

  before(async () => {
    // 1) 用 provider 钱包作为单管理员，先把合约 multisig 指向我们将创建的真实多签。
    //    顺序：创建真实 Squads 多签 -> 合约 propose_multisig -> accept_multisig。
    const createIx = await createMultisig({
      connection: provider.connection,
      createKey: members[0].publicKey, // 简化：用 member0 作 createKey
      creator: provider.wallet.publicKey,
      multisigPda: getMultisigPda({ createKey: members[0].publicKey }),
      owners: members.map((m) => m.publicKey),
      threshold: new BN(2),
      configAuthority: null,
    });
    // 注：createMultisig 返回 ITransaction | { instruction } 依版本而异；以实际 SDK 为准。
    const sig = await provider.sendAndConfirm(
      new Transaction().add(createIx as TransactionInstruction),
    );
    void sig;

    multisigPda = getMultisigPda({ createKey: members[0].publicKey });
    vaultPda = getVaultPda({ multisigPda, index: 0 })[0];

    // 2) 合约侧配置 multisig（单管理员阶段，test-build 可用小 delay）。
    await program.methods
      .proposeMultisig(multisigPda, new BN(1))
      .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
      .rpc();
    await program.methods
      .acceptMultisig()
      .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
      .rpc();

    const reg = await program.account.registry.fetch(REGISTRY());
    if (!reg.multisig || reg.multisig.toBase58() !== multisigPda.toBase58()) {
      throw new Error("合约 multisig 未正确指向真实 Squads 多签");
    }
  });

  it("single-signer admin call is rejected (MultisigEnforced)", async () => {
    const reg = await program.account.registry.fetch(REGISTRY());
    const supPda = PublicKey.findProgramAddressSync(
      [Buffer.from("supply_chain"), Buffer.from("supplier"), provider.wallet.publicKey.toBuffer()],
      program.programId,
    )[0];
    await assert.rejects(
      program.methods
        .authorizeSupplier(provider.wallet.publicKey)
        .accounts({
          registry: REGISTRY(),
          admin: provider.wallet.publicKey,
          supplier: supPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      /MultisigEnforced|Squads vault PDA/i,
    );
  });

  it("Squads VaultTransaction (vault PDA signs) authorizes supplier successfully", async () => {
    // 3) 构造一笔 VaultTransaction，其指令为合约 authorizeSupplier。
    const supplierKey = members[1].publicKey;
    const supplierPda = PublicKey.findProgramAddressSync(
      [Buffer.from("supply_chain"), Buffer.from("supplier"), supplierKey.toBuffer()],
      program.programId,
    )[0];

    // 合约指令（作为 VaultTransaction 的 inner instruction）。
    const ixData = program.coder.instruction.encode("authorizeSupplier", {
      supplierKey,
    });
    const innerIx: InstructionData = {
      programId: program.programId,
      accounts: [
        { pubkey: REGISTRY(), isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: true, isWritable: false }, // vault PDA 作为签名者
        { pubkey: supplierPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(ixData),
    };

    txIndex = 1;
    vaultTxPda = getVaultTransactionPda({ multisigPda, index: txIndex })[0];

    const createVtIx = await createVaultTransaction({
      connection: provider.connection,
      multisigPda,
      transactionPda: vaultTxPda,
      creator: members[0].publicKey,
      vaultIndex: 0,
      // index / bump 等参数依 SDK 版本而定
    } as any);
    await provider.sendAndConfirm(new Transaction().add(createVtIx as TransactionInstruction));

    const addIx = await addInstructionToVaultTransaction({
      connection: provider.connection,
      multisigPda,
      transactionPda: vaultTxPda,
      creator: members[0].publicKey,
      instruction: innerIx,
    } as any);
    await provider.sendAndConfirm(new Transaction().add(addIx as TransactionInstruction));

    // 4) 2/3 成员 approve。
    for (const m of [members[0], members[1]]) {
      const appIx = await approveVaultTransaction({
        connection: provider.connection,
        multisigPda,
        transactionPda: vaultTxPda,
        owner: m.publicKey,
      } as any);
      await provider.sendAndConfirm(
        new Transaction().add(appIx as TransactionInstruction).sign(m),
      );
    }

    // 5) 执行：Squads 以 vault PDA 作为 CPI 签名者调用合约，应成功（非 MultisigEnforced）。
    const execIx = await executeVaultTransaction({
      connection: provider.connection,
      multisigPda,
      transactionPda: vaultTxPda,
      vaultPda,
      // 其余账户（合约 registry / supplier / systemProgram）依 SDK 版本而定
    } as any);
    const execSig = await provider.sendAndConfirm(
      new Transaction().add(execIx as TransactionInstruction),
    );
    void execSig;

    const sup = await program.account.supplier.fetch(supplierPda);
    assert.equal(sup.supplier.toBase58(), supplierKey.toBase58());
    console.log("H-1 SC positive path OK: Squads vault PDA 签名被合约接受");
  });
});
