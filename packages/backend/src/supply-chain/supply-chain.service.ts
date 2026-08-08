import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildAuthorizeSupplierTransaction,
  buildInitializeRegistryTransaction,
  buildRegisterProductTransaction,
  buildRevokeSupplierTransaction,
  buildAuthorizeSupplierInstructionData,
  buildRegisterProductInstructionData,
  buildRevokeSupplierInstructionData,
  deriveProductPda,
  deriveRegistryPda,
  deriveSupplierPda,
  getConnection,
  getProgramId,
  serializeTransaction,
  supplyChainDiscriminator,
  verifySupplyChainInstruction,
} from "./solana/tx-builder";

const MAX_SKU_LENGTH = 64;

@Injectable()
export class SupplyChainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private parsePubkey(value: string, field: string): PublicKey {
    try {
      return new PublicKey(value);
    } catch {
      throw new BadRequestException(`invalid ${field}`);
    }
  }

  private async expectTransaction(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "链上校验失败",
      );
    }
  }

  async registryStatus(): Promise<{
    initialized: boolean;
    registry: string;
    admin: string | null;
    initializedAt: number | null;
  }> {
    const registry = deriveRegistryPda(getProgramId());
    const info = await getConnection().getAccountInfo(registry, "confirmed");
    if (!info) {
      return {
        initialized: false,
        registry: registry.toBase58(),
        admin: null,
        initializedAt: null,
      };
    }
    const admin = new PublicKey(info.data.subarray(8, 40)).toBase58();
    const initializedAt = Number(info.data.readBigInt64LE(40));
    return { initialized: true, registry: registry.toBase58(), admin, initializedAt };
  }

  // ---- Registry ----
  async buildInitRegistry(adminWallet: string) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    const { transaction, blockhash } = await buildInitializeRegistryTransaction(
      admin,
      getConnection(),
    );
    return {
      transaction: serializeTransaction(transaction),
      blockhash,
      registry: deriveRegistryPda(getProgramId()).toBase58(),
    };
  }

  async confirmInitRegistry(
    actorId: string,
    adminWallet: string,
    txSignature: string,
  ) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    await this.expectTransaction(() =>
      verifySupplyChainInstruction(
        txSignature,
        supplyChainDiscriminator("initialize_registry"),
      ),
    );
    const status = await this.registryStatus();
    if (!status.initialized) {
      throw new BadRequestException("registry was not initialized on chain");
    }
    if (status.admin !== admin.toBase58()) {
      throw new ConflictException("registry admin does not match the signing wallet");
    }
    await this.audit.record({
      actorId,
      action: "SUPPLY_CHAIN_REGISTRY_INIT",
      targetType: "SUPPLY_CHAIN",
      targetId: status.registry,
      metadata: { admin: status.admin, txSignature },
    });
    return { ok: true, ...status };
  }

  // ---- Suppliers ----
  async listSuppliers() {
    const rows = await this.prisma.supplier.findMany({
      where: { revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    });
    return rows.map((row) => ({
      address: row.address,
      pda: row.pda,
      authorizedAt: row.authorizedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async buildAuthorizeSupplier(adminWallet: string, supplierWallet: string) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    const supplier = this.parsePubkey(supplierWallet, "supplier");
    const { transaction, blockhash } = await buildAuthorizeSupplierTransaction(
      admin,
      supplier,
      getConnection(),
    );
    return {
      transaction: serializeTransaction(transaction),
      blockhash,
      supplier: supplier.toBase58(),
      supplierPda: deriveSupplierPda(getProgramId(), supplier).toBase58(),
    };
  }

  async confirmAuthorizeSupplier(
    actorId: string,
    supplierWallet: string,
    txSignature: string,
  ) {
    const supplier = this.parsePubkey(supplierWallet, "supplier");
    const pda = deriveSupplierPda(getProgramId(), supplier);
    await this.expectTransaction(() =>
      verifySupplyChainInstruction(
        txSignature,
        buildAuthorizeSupplierInstructionData(supplier),
        pda,
      ),
    );
    const info = await getConnection().getAccountInfo(pda, "confirmed");
    if (!info) {
      throw new BadRequestException("supplier account not initialized on chain");
    }
    await this.prisma.supplier.upsert({
      where: { address: supplier.toBase58() },
      create: {
        address: supplier.toBase58(),
        pda: pda.toBase58(),
        authorizedAt: new Date(),
        createdById: actorId,
      },
      update: { revokedAt: null, authorizedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: "SUPPLY_CHAIN_SUPPLIER_AUTHORIZED",
      targetType: "SUPPLY_CHAIN",
      targetId: supplier.toBase58(),
      metadata: { pda: pda.toBase58(), txSignature },
    });
    return { ok: true, supplier: supplier.toBase58(), pda: pda.toBase58() };
  }

  async buildRevokeSupplier(adminWallet: string, supplierWallet: string) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    const supplier = this.parsePubkey(supplierWallet, "supplier");
    const { transaction, blockhash } = await buildRevokeSupplierTransaction(
      admin,
      supplier,
      getConnection(),
    );
    return {
      transaction: serializeTransaction(transaction),
      blockhash,
      supplier: supplier.toBase58(),
      supplierPda: deriveSupplierPda(getProgramId(), supplier).toBase58(),
    };
  }

  async confirmRevokeSupplier(
    actorId: string,
    supplierWallet: string,
    txSignature: string,
  ) {
    const supplier = this.parsePubkey(supplierWallet, "supplier");
    const pda = deriveSupplierPda(getProgramId(), supplier);
    await this.expectTransaction(() =>
      verifySupplyChainInstruction(
        txSignature,
        buildRevokeSupplierInstructionData(supplier),
        pda,
      ),
    );
    const info = await getConnection().getAccountInfo(pda, "confirmed");
    if (info) {
      throw new BadRequestException("supplier account still exists on chain");
    }
    await this.prisma.supplier.updateMany({
      where: { address: supplier.toBase58() },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: "SUPPLY_CHAIN_SUPPLIER_REVOKED",
      targetType: "SUPPLY_CHAIN",
      targetId: supplier.toBase58(),
      metadata: { pda: pda.toBase58(), txSignature },
    });
    return { ok: true, supplier: supplier.toBase58() };
  }

  // ---- Products ----
  async listProducts() {
    const rows = await this.prisma.product.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      owner: row.owner,
      sku: row.sku,
      units: row.units.toString(),
      pda: row.pda,
      txSignature: row.txSignature,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async buildRegisterProduct(
    adminWallet: string,
    sku: string,
    units: string,
    supplierKey?: string,
  ) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    this.validateSku(sku);
    const unitsBig = this.parseUnits(units);
    const supplier = supplierKey ? this.parsePubkey(supplierKey, "supplierKey") : undefined;
    const { transaction, blockhash } = await buildRegisterProductTransaction(
      admin,
      sku,
      unitsBig,
      getConnection(),
      supplier,
    );
    return {
      transaction: serializeTransaction(transaction),
      blockhash,
      productPda: deriveProductPda(getProgramId(), admin, sku).toBase58(),
    };
  }

  async confirmRegisterProduct(
    actorId: string,
    adminWallet: string,
    sku: string,
    units: string,
    txSignature: string,
    supplierKey?: string,
  ) {
    const admin = this.parsePubkey(adminWallet, "adminWallet");
    this.validateSku(sku);
    const unitsBig = this.parseUnits(units);
    const pda = deriveProductPda(getProgramId(), admin, sku);
    const supplier = supplierKey
      ? this.parsePubkey(supplierKey, "supplierKey")
      : undefined;
    await this.expectTransaction(() =>
      verifySupplyChainInstruction(
        txSignature,
        buildRegisterProductInstructionData(
          sku,
          unitsBig,
          supplier ?? admin,
        ),
        pda,
      ),
    );
    const info = await getConnection().getAccountInfo(pda, "confirmed");
    if (!info) {
      throw new BadRequestException("product account not initialized on chain");
    }
    try {
      await this.prisma.product.create({
        data: {
          owner: admin.toBase58(),
          sku,
          units: unitsBig,
          pda: pda.toBase58(),
          txSignature,
          createdById: actorId,
        },
      });
    } catch (error) {
      if (String(error).includes("Unique constraint")) {
        throw new ConflictException("该 SKU 已由同一钱包注册");
      }
      throw error;
    }
    await this.audit.record({
      actorId,
      action: "SUPPLY_CHAIN_PRODUCT_REGISTERED",
      targetType: "SUPPLY_CHAIN",
      targetId: pda.toBase58(),
      metadata: { owner: admin.toBase58(), sku, units: unitsBig.toString(), txSignature },
    });
    return {
      ok: true,
      product: {
        owner: admin.toBase58(),
        sku,
        units: unitsBig.toString(),
        pda: pda.toBase58(),
      },
    };
  }

  private validateSku(sku: string): void {
    if (!sku || sku.length > MAX_SKU_LENGTH) {
      throw new BadRequestException("SKU 不能为空且长度不超过 64 字符");
    }
  }

  private parseUnits(units: string): bigint {
    if (!/^\d+$/.test(units ?? "")) {
      throw new BadRequestException("units 必须是正整数");
    }
    const value = BigInt(units);
    if (value <= 0n) {
      throw new BadRequestException("units 必须是正整数");
    }
    return value;
  }
}
