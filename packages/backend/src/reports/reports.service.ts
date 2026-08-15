import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma, DealStatus } from "@prisma/client";

const USDC = 1_000_000n;

function fmtUsdc(raw: bigint | number): string {
  const n = BigInt(raw);
  return `${n / USDC}.${String(n % USDC).padStart(6, "0").slice(0, 2)}`;
}

function parseRange(from?: string, to?: string) {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(to) : undefined;
  return { gte, lte };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async orders(from?: string, to?: string, status?: string) {
    const { gte, lte } = parseRange(from, to);
    const where: Prisma.TradeDealWhereInput = {
      ...(gte || lte ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {}),
      ...(status ? { status: status as DealStatus } : {}),
    };
    const [items, total, agg] = await Promise.all([
      this.prisma.tradeDeal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true, dealId: true, buyerWallet: true, sellerWallet: true,
          amount: true, downPayment: true, status: true, createdAt: true, repaidAt: true,
        },
      }),
      this.prisma.tradeDeal.count({ where }),
      this.prisma.tradeDeal.aggregate({
        where,
        _sum: { amount: true, downPayment: true },
        _count: true,
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const it of items) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
    return {
      summary: {
        total,
        amountTotal: fmtUsdc(agg._sum?.amount ?? 0n),
        downPaymentTotal: fmtUsdc(agg._sum?.downPayment ?? 0n),
        byStatus,
      },
      items: items.map((it) => ({
        ...it,
        amount: fmtUsdc(it.amount),
        downPayment: fmtUsdc(it.downPayment),
        createdAt: it.createdAt.toISOString(),
        repaidAt: it.repaidAt?.toISOString() ?? null,
      })),
    };
  }

  async financing(from?: string, to?: string, status?: string) {
    const { gte, lte } = parseRange(from, to);
    const where: Prisma.FinancingRequestWhereInput = {
      ...(gte || lte ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total, agg] = await Promise.all([
      this.prisma.financingRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true, invoiceId: true, applicantId: true, invoiceAmount: true,
          amount: true, discountRate: true, tenorDays: true, status: true,
          reviewedAt: true, createdAt: true,
        },
      }),
      this.prisma.financingRequest.count({ where }),
      this.prisma.financingRequest.aggregate({
        where,
        _sum: { amount: true, invoiceAmount: true },
        _count: true,
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const it of items) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
    return {
      summary: {
        total,
        amountTotal: fmtUsdc(agg._sum?.amount ?? 0n),
        invoiceAmountTotal: fmtUsdc(agg._sum?.invoiceAmount ?? 0n),
        byStatus,
      },
      items: items.map((it) => ({
        ...it,
        invoiceAmount: fmtUsdc(it.invoiceAmount),
        amount: fmtUsdc(it.amount),
        createdAt: it.createdAt.toISOString(),
        reviewedAt: it.reviewedAt?.toISOString() ?? null,
      })),
    };
  }

  async audit(from?: string, to?: string, action?: string) {
    const { gte, lte } = parseRange(from, to);
    const where: Prisma.AuditLogWhereInput = {
      ...(gte || lte ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {}),
      ...(action ? { action } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true, actorEmail: true, action: true, targetType: true,
          targetId: true, metadata: true, createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const byAction: Record<string, number> = {};
    for (const it of items) byAction[it.action] = (byAction[it.action] ?? 0) + 1;
    return {
      summary: { total, byAction },
      items: items.map((it) => ({
        ...it,
        createdAt: it.createdAt.toISOString(),
      })),
    };
  }

  private toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  }

  async ordersCsv(from?: string, to?: string) {
    const data = await this.orders(from, to);
    const rows = data.items.map((it) => [
      it.dealId, it.status, it.amount, it.downPayment,
      it.buyerWallet.slice(0, 12), it.sellerWallet.slice(0, 12), it.createdAt,
    ]);
    return this.toCsv(
      ["订单号", "状态", "金额(USDC)", "首付(USDC)", "买家", "卖家", "创建时间"],
      rows,
    );
  }

  async financingCsv(from?: string, to?: string) {
    const data = await this.financing(from, to);
    const rows = data.items.map((it) => [
      it.id, it.status, it.amount, it.invoiceAmount, it.discountRate, it.tenorDays, it.createdAt,
    ]);
    return this.toCsv(
      ["融资单ID", "状态", "融资额(USDC)", "发票额(USDC)", "贴现率", "账期(天)", "创建时间"],
      rows,
    );
  }

  async auditCsv(from?: string, to?: string) {
    const data = await this.audit(from, to);
    const rows = data.items.map((it) => [
      it.id, it.createdAt, it.action, it.actorEmail ?? "", it.targetType, it.targetId,
    ]);
    return this.toCsv(
      ["审计ID", "时间", "动作", "操作人", "对象类型", "对象ID"],
      rows,
    );
  }
}
