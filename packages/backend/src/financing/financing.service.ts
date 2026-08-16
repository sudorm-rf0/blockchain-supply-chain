import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Connection, PublicKey } from "@solana/web3.js";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TurnstileService } from "../auth/turnstile.service";
import { verifyUsdcTransfer } from "./solana-verify";
import { ApproveFinancingDto } from "./dto/approve-financing.dto";
import { RepayFinancingDto } from "./dto/repay-financing.dto";

const DEFAULT_DISCOUNT_RATE = 800; // 8%

@Injectable()
export class FinancingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly turnstile: TurnstileService,
  ) {}

  // ---- 审计 H-4：链上证据校验基础设施 ----
  private getConnection(): Connection {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) throw new BadRequestException("SOLANA_RPC_URL 未配置，无法校验链上转账");
    return new Connection(url, {
      commitment: "confirmed",
      fetch: (fetchUrl, options) =>
        fetch(fetchUrl, { ...options, signal: AbortSignal.timeout(30_000) }),
    });
  }

  private getUsdcMint(): PublicKey {
    const m = process.env.FINANCING_USDC_MINT || process.env.USDC_MINT;
    if (!m) throw new BadRequestException("USDC mint 未配置，无法校验链上转账");
    return new PublicKey(m);
  }

  private getPlatformWallet(): PublicKey {
    const w = process.env.FINANCING_PLATFORM_WALLET;
    if (!w) throw new BadRequestException("FINANCING_PLATFORM_WALLET 未配置，无法校验链上转账");
    return new PublicKey(w);
  }

  async apply(
    userId: string,
    input: { invoiceId: string; invoiceAmount: string; amount: string; discountRate?: number; tenorDays: number; turnstileToken?: string },
  ) {
    if (!(await this.turnstile.verify(input.turnstileToken, { expectedAction: "sensitive" }))) {
      throw new BadRequestException("人机验证未通过，请重试");
    }
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

  async approve(id: string, adminId: string, dto: ApproveFinancingDto) {
    const req = await this.prisma.financingRequest.findUnique({
      where: { id },
      include: { applicant: { select: { wallet: true } } },
    });
    if (!req) throw new NotFoundException("融资申请不存在");
    if (req.status !== "PENDING") throw new BadRequestException("仅待审核的申请可操作");
    if (!req.applicant?.wallet) throw new BadRequestException("申请人未绑定钱包，无法校验放款");
    // 审计 H-4：放款必须存在平台→申请人的链上 USDC 转账证据，否则账实不符。
    await verifyUsdcTransfer(
      this.getConnection(),
      dto.txSignature,
      this.getUsdcMint(),
      { from: this.getPlatformWallet(), to: new PublicKey(req.applicant.wallet), minAmount: req.amount },
    );
    const updated = await this.prisma.financingRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedById: adminId,
        reviewedAt: new Date(),
        disbursedTxSignature: dto.txSignature,
      },
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

  async repay(id: string, userId: string, dto: RepayFinancingDto) {
    const req = await this.prisma.financingRequest.findUnique({
      where: { id },
      include: { applicant: { select: { wallet: true } } },
    });
    if (!req) throw new NotFoundException("融资申请不存在");
    if (req.applicantId !== userId) throw new ForbiddenException("仅申请人可操作");
    if (req.status !== "APPROVED") throw new BadRequestException("仅已批准的融资可还款");
    if (!req.applicant?.wallet) throw new BadRequestException("未绑定钱包，无法校验还款");
    // 审计 H-4：还款必须存在申请人→平台的链上 USDC 转账证据，杜绝零成本标记还清。
    await verifyUsdcTransfer(
      this.getConnection(),
      dto.txSignature,
      this.getUsdcMint(),
      { from: new PublicKey(req.applicant.wallet), to: this.getPlatformWallet(), minAmount: req.amount },
    );
    const updated = await this.prisma.financingRequest.update({
      where: { id },
      data: { status: "REPAID", repaidAt: new Date(), repaidTxSignature: dto.txSignature },
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
