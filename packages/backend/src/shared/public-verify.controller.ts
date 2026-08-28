import { Controller, Get, Param, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 公开核验 / 溯源接口（无需登录，用于扫码/链接核验、外部监管与客户查询）：
 * - verify  按文件哈希 / 文件 ID / 链上交易签名查询存证真伪
 * - trace   按资产 ID（文件/订单/产品）查看链上溯源时间线
 * - activity 最近链上活动流（存证 / 订单 / 产品）
 */

function solscanTxUrl(txSignature: string): string {
  const rpc = process.env.SOLANA_RPC_URL ?? "";
  const cluster = rpc.includes("devnet") ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${txSignature}${cluster}`;
}

const FILE_SELECT = {
  id: true,
  filename: true,
  hash: true,
  status: true,
  createdAt: true,
  analyzedAt: true,
  authScore: true,
  attestedAt: true,
  txSignature: true,
  documentPda: true,
} as const;

@SkipThrottle()
@Controller("api/public")
export class PublicVerifyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("verify")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async verify(
    @Query("hash") hash?: string,
    @Query("id") id?: string,
    @Query("tx") tx?: string,
  ) {
    const file = await this.findFile(hash, id, tx);
    if (!file) {
      return { ok: false, error: "not found" };
    }
    return {
      ok: true,
      file: {
        filename: file.filename,
        hash: file.hash,
        status: file.status,
        createdAt: file.createdAt.toISOString(),
        analyzedAt: file.analyzedAt?.toISOString() ?? null,
        attestedAt: file.attestedAt?.toISOString() ?? null,
        txSignature: file.txSignature,
        documentPda: file.documentPda,
        solscanUrl: file.txSignature ? solscanTxUrl(file.txSignature) : null,
      },
    };
  }

  /** 溯源时间线：文件 / 订单 / 产品的链上事件 */
  @Get("trace/:id")
  async trace(@Param("id") id: string) {
    const [file, deal, product] = await Promise.all([
      this.prisma.file.findUnique({
        where: { id },
        select: FILE_SELECT,
      }),
      this.prisma.tradeDeal.findUnique({
        where: { id },
        select: {
          id: true,
          dealId: true,
          status: true,
          amount: true,
          buyerWallet: true,
          sellerWallet: true,
          createdAt: true,
          repaidAt: true,
          txSignature: true,
        },
      }),
      this.prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          sku: true,
          units: true,
          owner: true,
          pda: true,
          txSignature: true,
          createdAt: true,
        },
      }),
    ]);

    if (file) {
      const events: Array<{
        type: string;
        label: string;
        timestamp: string;
        detail?: string;
        txSignature?: string;
        solscanUrl?: string;
      }> = [];
      events.push({
        type: "UPLOAD",
        label: "单据上传",
        timestamp: file.createdAt.toISOString(),
      });
      if (file.analyzedAt) {
        events.push({
          type: "ANALYZE",
          label: "真伪与内容分析",
          timestamp: file.analyzedAt.toISOString(),
          detail: undefined,
        });
      }
      if (file.attestedAt && file.txSignature) {
        events.push({
          type: "ATTEST",
          label: "链上存证",
          timestamp: file.attestedAt.toISOString(),
          txSignature: file.txSignature,
          solscanUrl: solscanTxUrl(file.txSignature),
          detail: file.documentPda ? `存证 PDA: ${file.documentPda}` : undefined,
        });
      }
      return {
        ok: true,
        asset: {
          type: "FILE",
          name: file.filename,
          hash: file.hash.slice(0, 16),
          status: file.status,
        },
        events: events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      };
    }

    if (deal) {
      const events: Array<{
        type: string;
        label: string;
        timestamp: string;
        detail?: string;
        txSignature?: string;
        solscanUrl?: string;
      }> = [
        {
          type: "TRADE_CREATED",
          label: "订单创建",
          timestamp: deal.createdAt.toISOString(),
          detail: `金额 ${deal.amount.toString()}，买家 ${deal.buyerWallet.slice(0, 8)}…`,
        },
      ];
      if (deal.txSignature) {
        events.push({
          type: "TRADE_ONCHAIN",
          label: "链上确认",
          timestamp: deal.createdAt.toISOString(),
          txSignature: deal.txSignature,
          solscanUrl: solscanTxUrl(deal.txSignature),
        });
      }
      return {
        ok: true,
        asset: { type: "TRADE", id: deal.id, name: deal.dealId, status: deal.status },
        events: events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      };
    }

    if (product) {
      const events = [
        {
          type: "PRODUCT_CREATED",
          label: "产品上链",
          timestamp: product.createdAt.toISOString(),
          txSignature: product.txSignature ?? undefined,
          solscanUrl: product.txSignature ? solscanTxUrl(product.txSignature) : undefined,
          detail: `SKU ${product.sku} · ${product.units.toString()} 件 · PDA ${product.pda}`,
        },
      ];
      return { ok: true, asset: { type: "PRODUCT", id: product.id, name: product.sku }, events };
    }

    return { ok: false, error: "not found" };
  }

  /** 最近链上活动流 */
  @Get("activity")
  async activity(@Query("limit") limit?: string) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    const [files, deals, products] = await Promise.all([
      this.prisma.file.findMany({
        where: { attestedAt: { not: null }, txSignature: { not: null } },
        orderBy: { attestedAt: "desc" },
        take: n,
        select: FILE_SELECT,
      }),
      this.prisma.tradeDeal.findMany({
        where: { txSignature: { not: null } },
        orderBy: { createdAt: "desc" },
        take: n,
        select: { id: true, dealId: true, createdAt: true, txSignature: true },
      }),
      this.prisma.product.findMany({
        where: { txSignature: { not: null } },
        orderBy: { createdAt: "desc" },
        take: n,
        select: { id: true, sku: true, createdAt: true, txSignature: true },
      }),
    ]);

    const items: Array<{
      type: string;
      id: string;
      title: string;
      timestamp: string;
      txSignature?: string;
      solscanUrl?: string;
    }> = [
      ...files.map((f) => ({
        type: "FILE_ATTEST" as const,
        id: f.id,
        title: `单据存证：${f.filename}`,
        timestamp: f.attestedAt!.toISOString(),
        txSignature: f.txSignature!,
        solscanUrl: solscanTxUrl(f.txSignature!),
      })),
      ...deals.map((d) => ({
        type: "TRADE" as const,
        id: d.id,
        title: `订单上链：${d.dealId}`,
        timestamp: d.createdAt.toISOString(),
        txSignature: d.txSignature!,
        solscanUrl: solscanTxUrl(d.txSignature!),
      })),
      ...products.map((p) => ({
        type: "PRODUCT" as const,
        id: p.id,
        title: `产品上链：SKU ${p.sku}`,
        timestamp: p.createdAt.toISOString(),
        txSignature: p.txSignature!,
        solscanUrl: solscanTxUrl(p.txSignature!),
      })),
    ];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return { ok: true, items: items.slice(0, n) };
  }

  private async findFile(
    hash?: string,
    id?: string,
    tx?: string,
  ) {
    if (hash && /^[a-f0-9]{64}$/i.test(hash)) {
      return this.prisma.file.findFirst({
        where: { hash: hash.toLowerCase() },
        orderBy: { createdAt: "desc" },
        select: FILE_SELECT,
      });
    }
    if (id) {
      return this.prisma.file.findUnique({ where: { id }, select: FILE_SELECT });
    }
    if (tx && /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(tx)) {
      return this.prisma.file.findFirst({
        where: { txSignature: tx },
        select: FILE_SELECT,
      });
    }
    return null;
  }
}
