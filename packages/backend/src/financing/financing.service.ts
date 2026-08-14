import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

const DEFAULT_DISCOUNT_RATE = 800; // 8%

@Injectable()
export class FinancingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async apply(
    userId: string,
    input: { invoiceId: string; invoiceAmount: string; amount: string; discountRate?: number; tenorDays: number },
  ) {
    const invoice = await this.prisma.file.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, uploaderId: true, status: true, hash: true, filename: true },
    });
    if (!invoice) throw new NotFoundException("发票单据不存在");
    if (invoice.uploaderId !== userId) {
      throw new ForbiddenException("只能对本人上传的发票申请融资");
    }
    if (invoice.status !== "APPROVED") {
      throw new BadRequestException("仅已审核通过的发票可申请融资");
    }
    const existing = await this.prisma.financingRequest.findFirst({
      where: { invoiceId: input.invoiceId, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true },
    });
    if (existing) throw new ConflictException("该发票已存在融资申请");

    const invoiceAmount = BigInt(input.invoiceAmount);
    const amount = BigInt(input.amount);
    if (invoiceAmount <= 0n || amount <= 0n) {
      throw new BadRequestException("金额必须大于 0");
    }
    if (amount > invoiceAmount) {
      throw new BadRequestException("融资金额不能超过发票金额");
    }
    const discountRate = input.discountRate ?? DEFAULT_DISCOUNT_RATE;
    const maxAmount = (invoiceAmount * BigInt(10000 - discountRate)) / 10000n;
    if (amount > maxAmount) {
      throw new BadRequestException(
        `融资金额超出折扣上限（最高 ${(Number(maxAmount) / 1e6).toFixed(2)} USDC）`,
      );
    }

    const created = await this.prisma.financingRequest.create({
      data: {
        invoiceId: input.invoiceId,
        applicantId: userId,
        invoiceAmount,
        amount,
        discountRate,
        tenorDays: input.tenorDays,
      },
      include: { invoice: { select: { filename: true, hash: true } } },
    });
    await this.audit.record({
      actorId: userId,
      action: "FINANCING_APPLIED",
      targetType: "FINANCING",
      targetId: created.id,
      metadata: { invoiceId: input.invoiceId, amount: amount.toString() },
    });
    return this.publicRequest(created);
  }

  async mine(userId: string) {
    const items = await this.prisma.financingRequest.findMany({
      where: { applicantId: userId },
      orderBy: { createdAt: "desc" },
      include: { invoice: { select: { id: true, filename: true, hash: true } } },
    });
    return { items: items.map((r) => this.publicRequest(r)) };
  }

  async adminList() {
    const items = await this.prisma.financingRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { id: true, filename: true, hash: true } },
        applicant: { select: { name: true, email: true } },
      },
    });
    return { items: items.map((r) => this.publicRequest(r)) };
  }

  async approve(id: string, adminId: string) {
    const req = await this.prisma.financingRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("融资申请不存在");
    if (req.status !== "PENDING") throw new BadRequestException("仅待审核的申请可操作");
    const updated = await this.prisma.financingRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
      include: { invoice: { select: { filename: true, hash: true } } },
    });
    await this.audit.record({
      actorId: adminId,
      action: "FINANCING_APPROVED",
      targetType: "FINANCING",
      targetId: id,
      metadata: { amount: req.amount.toString() },
    });
    return this.publicRequest(updated);
  }

  async reject(id: string, adminId: string) {
    const req = await this.prisma.financingRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("融资申请不存在");
    if (req.status !== "PENDING") throw new BadRequestException("仅待审核的申请可操作");
    const updated = await this.prisma.financingRequest.update({
      where: { id },
      data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date() },
      include: { invoice: { select: { filename: true, hash: true } } },
    });
    await this.audit.record({
      actorId: adminId,
      action: "FINANCING_REJECTED",
      targetType: "FINANCING",
      targetId: id,
    });
    return this.publicRequest(updated);
  }

  async repay(id: string, userId: string) {
    const req = await this.prisma.financingRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("融资申请不存在");
    if (req.applicantId !== userId) throw new ForbiddenException("仅申请人可操作");
    if (req.status !== "APPROVED") throw new BadRequestException("仅已批准的融资可还款");
    const updated = await this.prisma.financingRequest.update({
      where: { id },
      data: { status: "REPAID", repaidAt: new Date() },
      include: { invoice: { select: { filename: true, hash: true } } },
    });
    await this.audit.record({
      actorId: userId,
      action: "FINANCING_REPAID",
      targetType: "FINANCING",
      targetId: id,
    });
    return this.publicRequest(updated);
  }

  private publicRequest(r: any) {
    return {
      id: r.id,
      invoiceId: r.invoiceId,
      invoiceFilename: r.invoice?.filename ?? null,
      invoiceHash: r.invoice?.hash ?? null,
      applicantName: r.applicant?.name ?? null,
      applicantEmail: r.applicant?.email ?? null,
      invoiceAmount: r.invoiceAmount.toString(),
      amount: r.amount.toString(),
      discountRate: r.discountRate,
      tenorDays: r.tenorDays,
      status: r.status,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      repaidAt: r.repaidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
