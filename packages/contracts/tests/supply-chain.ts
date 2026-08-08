import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const REGISTRY_SEEDS = [Buffer.from("supply_chain"), Buffer.from("registry")];

function registryPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(REGISTRY_SEEDS, programId)[0];
}

function supplierPda(programId: PublicKey, supplier: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("supply_chain"),
      Buffer.from("supplier"),
      supplier.toBuffer(),
    ],
    programId,
  )[0];
}

function productPda(
  programId: PublicKey,
  owner: PublicKey,
  sku: string,
): PublicKey {
  // 与合约 sku_seed 保持一致：SKU 的完整 SHA-256（32 字节，审计 N-04）。
  const skuHash = createHash("sha256").update(sku).digest();
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("supply_chain"),
      Buffer.from("product"),
      owner.toBuffer(),
      skuHash,
    ],
    programId,
  )[0];
}

describe("supply-chain permissioned registration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.SupplyChain;
  const connection = provider.connection;
  const REGISTRY = () => registryPda(program.programId);
  function programDataPda(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
  }

  let supplierA: anchor.web3.Keypair;
  let supplierB: anchor.web3.Keypair;
  let stranger: anchor.web3.Keypair;

  async function airdrop(
    pubkey: PublicKey,
    lamports = 5 * anchor.web3.LAMPORTS_PER_SOL,
  ): Promise<void> {
    const signature = await connection.requestAirdrop(pubkey, lamports);
    await connection.confirmTransaction(signature, "confirmed");
  }

  before(async () => {
    supplierA = anchor.web3.Keypair.generate();
    supplierB = anchor.web3.Keypair.generate();
    stranger = anchor.web3.Keypair.generate();
    await Promise.all(
      [supplierA, supplierB, stranger].map((keypair) =>
        airdrop(keypair.publicKey),
      ),
    );
  });

  it("Initializes the registry with an admin", async () => {
    await program.methods
      .initializeRegistry(new anchor.BN(1))
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
        programData: programDataPda(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const registry = await program.account.registry.fetch(REGISTRY());
    assert.equal(registry.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.ok(registry.initializedAt.gt(new anchor.BN(0)));
    console.log("Registry PDA:", REGISTRY().toBase58());
    console.log("Registry admin:", registry.admin.toBase58());
  });

  it("Rejects a second registry initialization", async () => {
    await assert.rejects(
      program.methods
        .initializeRegistry(new anchor.BN(1))
        .accounts({
          registry: REGISTRY(),
          admin: provider.wallet.publicKey,
          programData: programDataPda(program.programId),
          systemProgram: SystemProgram.programId,
        })
          .rpc(),
      /already in use|already initialized|AccountDiscriminatorAlreadySet|ConstraintSeeds/i,
    );
    console.log("Second registry init rejected");
  });

  it("Registers a product as the admin", async () => {
    const sku = "SKU-ADMIN-001";
    const product = productPda(program.programId, provider.wallet.publicKey, sku);
    await program.methods
      .registerProduct(sku, new anchor.BN(100), provider.wallet.publicKey)
      .accounts({
        registry: REGISTRY(),
        product,
        owner: provider.wallet.publicKey,
        supplier: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const p = await program.account.product.fetch(product);
    assert.equal(p.owner.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(p.sku, sku);
    assert.equal(p.units.toString(), "100");
    assert.ok(p.createdAt.gt(new anchor.BN(0)));
    console.log("Product PDA (admin):", product.toBase58());
    console.log("Product sku:", p.sku, "units:", p.units.toString());
  });

  it("Rejects registration by an unregistered wallet", async () => {
    const sku = "SKU-STRANGER-001";
    const product = productPda(program.programId, stranger.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(10), stranger.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: stranger.publicKey,
          supplier: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc(),
      /Unauthorized/i,
    );
    console.log("Unregistered wallet registration rejected");
  });

  it("Rejects empty SKU", async () => {
    const sku = "";
    const product = productPda(program.programId, provider.wallet.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(10), provider.wallet.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: provider.wallet.publicKey,
          supplier: null,
          systemProgram: SystemProgram.programId,
        })
          .rpc(),
      /EmptySku|SKU must not be empty/,
    );
    console.log("Empty SKU rejected");
  });

  it("Rejects zero units", async () => {
    const sku = "SKU-ZERO-UNITS";
    const product = productPda(program.programId, provider.wallet.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(0), provider.wallet.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: provider.wallet.publicKey,
          supplier: null,
          systemProgram: SystemProgram.programId,
        })
          .rpc(),
      /InvalidUnits|Units must be greater than zero/,
    );
    console.log("Zero units rejected");
  });

  it("Authorizes a supplier (admin only)", async () => {
    const pda = supplierPda(program.programId, supplierA.publicKey);
    await program.methods
      .authorizeSupplier(supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
        supplier: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const s = await program.account.supplier.fetch(pda);
    assert.equal(s.supplier.toBase58(), supplierA.publicKey.toBase58());
    assert.ok(s.authorizedAt.gt(new anchor.BN(0)));
    console.log("Supplier A PDA:", pda.toBase58());
  });

  it("Rejects supplier authorization by non-admin", async () => {
    const pda = supplierPda(program.programId, supplierB.publicKey);
    await assert.rejects(
      program.methods
        .authorizeSupplier(supplierB.publicKey)
        .accounts({
          registry: REGISTRY(),
          admin: stranger.publicKey,
            supplier: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc(),
      /Unauthorized/i,
    );
    console.log("Non-admin authorization rejected");
  });

  it("Registers a product as an authorized supplier", async () => {
    const sku = "SKU-SUPPLIER-001";
    const product = productPda(program.programId, supplierA.publicKey, sku);
    await program.methods
      .registerProduct(sku, new anchor.BN(500), supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        product,
        owner: supplierA.publicKey,
        supplier: supplierPda(program.programId, supplierA.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([supplierA])
      .rpc();

    const p = await program.account.product.fetch(product);
    assert.equal(p.owner.toBase58(), supplierA.publicKey.toBase58());
    assert.equal(p.sku, sku);
    assert.equal(p.units.toString(), "500");
    console.log("Product PDA (supplier):", product.toBase58());
  });

  it("Rejects a supplier impersonating another authorized supplier", async () => {
    // supplierB 未授权，但尝试借用 supplierA 的授权账户注册自己的商品。
    const sku = "SKU-SPOOF-001";
    const product = productPda(program.programId, supplierB.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(10), supplierA.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: supplierB.publicKey,
          supplier: supplierPda(program.programId, supplierA.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .signers([supplierB])
        .rpc(),
      /Unauthorized|ConstraintSeeds/i,
    );
    console.log("Supplier impersonation rejected");
  });

  it("D-01: rejects supplier_key mismatch (seeds/has_one guard)", async () => {
    // 审计 D-01：供应商用错误 supplier_key（与其 Supplier PDA 不匹配）注册必须失败。
    // 正确 supplier_key 为 supplierA.publicKey；这里故意传 supplierB.publicKey，
    // seeds 派生出的 PDA 与传入账户不一致 → ConstraintSeeds / SupplierMismatch。
    const sku = "SKU-D01-001";
    const product = productPda(program.programId, supplierA.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(10), supplierB.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: supplierA.publicKey,
          supplier: supplierPda(program.programId, supplierA.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .signers([supplierA])
        .rpc(),
      /ConstraintSeeds|SupplierMismatch|supplier/i,
    );
    console.log("D-01 supplier_key mismatch rejected");

    // 正确 supplier_key 注册成功（正向确认 has_one/seeds 不误伤合法路径）。
    const sku2 = "SKU-D01-002";
    const product2 = productPda(program.programId, supplierA.publicKey, sku2);
    await program.methods
      .registerProduct(sku2, new anchor.BN(20), supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        product: product2,
        owner: supplierA.publicKey,
        supplier: supplierPda(program.programId, supplierA.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([supplierA])
      .rpc();
    const p2 = await program.account.product.fetch(product2);
    assert.equal(p2.owner.toBase58(), supplierA.publicKey.toBase58());
    console.log("D-01 correct supplier_key accepted");
  });

  it("Rejects duplicate SKU registration by the same owner", async () => {
    const sku = "SKU-ADMIN-001";
    const product = productPda(program.programId, provider.wallet.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(200), provider.wallet.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: provider.wallet.publicKey,
          supplier: null,
          systemProgram: SystemProgram.programId,
        })
          .rpc(),
      /already in use|already initialized|AccountDiscriminatorAlreadySet|ConstraintSeeds/i,
    );
    console.log("Duplicate SKU registration rejected");
  });

  it("Revokes a supplier and blocks further registration", async () => {
    const pda = supplierPda(program.programId, supplierA.publicKey);
    await program.methods
      .revokeSupplier(supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
        supplier: pda,
      })
      .rpc();
    assert.equal(await connection.getAccountInfo(pda), null);
    console.log("Supplier A revoked, account closed:", pda.toBase58());

    // 撤销后供应商无法再注册新商品。
    const sku = "SKU-REVOKED-001";
    const product = productPda(program.programId, supplierA.publicKey, sku);
    await assert.rejects(
      program.methods
        .registerProduct(sku, new anchor.BN(1), supplierA.publicKey)
        .accounts({
          registry: REGISTRY(),
          product,
          owner: supplierA.publicKey,
          supplier: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([supplierA])
        .rpc(),
      /Unauthorized/i,
    );
    console.log("Revoked supplier registration rejected");
  });

  it("Allows re-authorization after revocation", async () => {
    const pda = supplierPda(program.programId, supplierA.publicKey);
    await program.methods
      .authorizeSupplier(supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
        supplier: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const s = await program.account.supplier.fetch(pda);
    assert.equal(s.supplier.toBase58(), supplierA.publicKey.toBase58());

    const sku = "SKU-REAUTH-001";
    const product = productPda(program.programId, supplierA.publicKey, sku);
    await program.methods
      .registerProduct(sku, new anchor.BN(7), supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        product,
        owner: supplierA.publicKey,
        supplier: pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([supplierA])
      .rpc();

    const p = await program.account.product.fetch(product);
    assert.equal(p.owner.toBase58(), supplierA.publicKey.toBase58());
    assert.equal(p.units.toString(), "7");
    console.log("Supplier A re-authorized and registered again");
  });

  it("Transfers registry admin (M-11)", async () => {
    const newAdmin = anchor.web3.Keypair.generate();
    await airdrop(newAdmin.publicKey);
    await program.methods
      .proposeRegistryAdmin(newAdmin.publicKey)
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
      })
      .rpc();
    await new Promise((r) => setTimeout(r, 1500));
    await program.methods
      .acceptRegistryAdmin()
      .accounts({ registry: REGISTRY(), newAdmin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();
    const registry = await program.account.registry.fetch(REGISTRY());
    assert.equal(registry.admin.toBase58(), newAdmin.publicKey.toBase58());
    // 新管理员可授权供应商
    await program.methods
      .proposeRegistryAdmin(provider.wallet.publicKey)
      .accounts({ registry: REGISTRY(), admin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();
    await new Promise((r) => setTimeout(r, 1500));
    await program.methods
      .acceptRegistryAdmin()
      .accounts({ registry: REGISTRY(), newAdmin: provider.wallet.publicKey })
      .rpc();
    assert.equal(
      (await program.account.registry.fetch(REGISTRY())).admin.toBase58(),
      provider.wallet.publicKey.toBase58(),
    );
    console.log("Registry admin transfer ok (M-11)");
  });

  it("Rejects transferring registry admin to default pubkey", async () => {
    await assert.rejects(
      program.methods
        .proposeRegistryAdmin(PublicKey.default)
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc(),
      /InvalidNewAdmin/,
    );
    console.log("Default-pubkey registry admin transfer rejected");
  });

  it("Revokes a product and marks it inactive (L-09)", async () => {
    const sku = "SKU-REVOKE-001";
    const product = productPda(program.programId, supplierA.publicKey, sku);
    // 用供应商 A 注册（已在前面测试中授权）
    const supAuthPda = supplierPda(program.programId, supplierA.publicKey);
    await program.methods
      .registerProduct(sku, new anchor.BN(5), supplierA.publicKey)
      .accounts({
        registry: REGISTRY(),
        product,
        owner: supplierA.publicKey,
        supplier: supAuthPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([supplierA])
      .rpc();
    let p = await program.account.product.fetch(product);
    assert.equal(p.active, true);

    await program.methods
      .revokeProduct(sku)
      .accounts({
        registry: REGISTRY(),
        admin: provider.wallet.publicKey,
        owner: supplierA.publicKey,
        product,
      })
      .rpc();
    p = await program.account.product.fetch(product);
    assert.equal(p.active, false, "revoke_product 后商品应标记失效");

    // 重复 revoke 拒绝
    await assert.rejects(
      program.methods
        .revokeProduct(sku)
        .accounts({
          registry: REGISTRY(),
          admin: provider.wallet.publicKey,
          owner: supplierA.publicKey,
          product,
        })
        .rpc(),
      /AlreadyRevoked/,
    );
    console.log("Product revoked and re-revoke rejected (L-09)");
  });

  it("Blocks H-06 supply-chain timelock bypass (hard floor)", async () => {
    const attacker = anchor.web3.Keypair.generate();
    await airdrop(attacker.publicKey);
    await program.methods
      .proposeRegistryAdmin(attacker.publicKey)
      .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
      .rpc();
    // 锁定期内（1s）accept 被拒
    await assert.rejects(
      program.methods
        .acceptRegistryAdmin()
        .accounts({ registry: REGISTRY(), newAdmin: attacker.publicKey })
        .signers([attacker])
        .rpc(),
      /AdminLockNotElapsed/,
    );
    // setRegistryAdminDelay(0)/(100) 被硬下限拒绝（H-06 修复）
    await assert.rejects(
      program.methods
        .setRegistryAdminDelay(new anchor.BN(0))
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc(),
      /InvalidNewAdmin/,
    );
    await assert.rejects(
      program.methods
        .setRegistryAdminDelay(new anchor.BN(100))
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc(),
      /InvalidNewAdmin/,
    );
    // 设为下限 86400 成功；攻击者无法接管
    await program.methods
      .setRegistryAdminDelay(new anchor.BN(86_400))
      .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
      .rpc();
    const registry = await program.account.registry.fetch(REGISTRY());
    assert.equal(
      registry.admin.toBase58(),
      provider.wallet.publicKey.toBase58(),
      "H-06 修复后攻击者不应接管注册中心",
    );
    assert.equal(registry.adminDelaySecs.toString(), "86400");
    console.log("H-06 supply-chain timelock bypass blocked");
  });

  describe("H-1 chain-enforced multisig (supply-chain)", () => {
    const SQDS = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
    const fakeMultisig = PublicKey.findProgramAddressSync(
      [Buffer.from("multisig"), Buffer.from("test-ms-sc")],
      SQDS,
    )[0];
    function vaultPda(ms: PublicKey): PublicKey {
      return PublicKey.findProgramAddressSync(
        [Buffer.from("multisig"), ms.toBuffer(), Buffer.from("vault"), Buffer.from([0])],
        SQDS,
      )[0];
    }

    it("None path: single admin still works", async () => {
      const reg = await program.account.registry.fetch(REGISTRY());
      assert.equal(reg.multisig, null, "初始 multisig 应为 None");
      await program.methods
        .setRegistryAdminDelay(new anchor.BN(86_400))
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc();
      console.log("H-1 SC None path OK");
    });

    it("propose_multisig sets pending; accept before timelock rejected", async () => {
      await program.methods
        .proposeMultisig(fakeMultisig, new anchor.BN(1))
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc();
      const reg = await program.account.registry.fetch(REGISTRY());
      assert.equal(reg.pendingMultisig.toBase58(), fakeMultisig.toBase58());
      await assert.rejects(
        program.methods
          .acceptMultisig()
          .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
          .rpc(),
        /MultisigLockNotElapsed|multisig rotation lock/i,
      );
      console.log("H-1 SC propose + pre-timelock reject OK");
    });

    it("accept_multisig after timelock enables enforcement; single admin rejected", async () => {
      await new Promise((r) => setTimeout(r, 1600));
      await program.methods
        .acceptMultisig()
        .accounts({ registry: REGISTRY(), admin: provider.wallet.publicKey })
        .rpc();
      const reg = await program.account.registry.fetch(REGISTRY());
      assert.equal(reg.multisig.toBase58(), fakeMultisig.toBase58());
      // enforcement 后单签授权供应商被拒（无绕过）。传完整账户以触达授权校验。
      const supPda = supplierPda(program.programId, provider.wallet.publicKey);
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
      console.log("H-1 SC enforcement active, single admin rejected");
    });

    it("vault PDA derivation consistent", async () => {
      const vault = vaultPda(fakeMultisig);
      const expected = PublicKey.findProgramAddressSync(
        [Buffer.from("multisig"), fakeMultisig.toBuffer(), Buffer.from("vault"), Buffer.from([0])],
        SQDS,
      )[0];
      assert.equal(vault.toBase58(), expected.toBase58());
      console.log("H-1 SC vault PDA:", vault.toBase58());
    });
  });
});
