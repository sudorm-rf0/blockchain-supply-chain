import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type DealStatus } from "@prisma/client";
import { Connection, PublicKey } from "@solana/web3.js";
import { TRADE_ENV } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { ConfirmTradeDto } from "./dto/confirm-trade.dto";
import { ConfirmSignatureDto } from "./dto/confirm-signature.dto";
import { AdvanceTradeDto } from "./dto/advance-trade.dto";
import { TradeItemDto } from "./dto/trade-item.dto";
import {
  BPS_BASE,
  DOWN_PAYMENT_BPS,
  buildAdvanceDealInstructionData,
  buildAdvanceDealTransaction,
  buildCreateDealInstructionData,
  buildCreateDealTransaction,
  buildDefaultDealInstructionData,
  buildDefaultDealTransaction,
  buildFundDealInstructionData,
  buildFundDealTransaction,
  buildRepayDealInstructionData,
  buildRepayDealTransaction,
  buildReleaseToSellerInstructionData,
  buildReleaseToSellerTransaction,
  deriveAssociatedTokenAccount,
  deriveDealPda,
  generateTradeId,
  isValidTenor,
} from "./solana/tx-builder";

let _connection: Connection | undefined;
let _programId: PublicKey | undefined;

function getConnection(): Connection {
  return (_connection ??= new Connection(TRADE_ENV.rpcUrl, {
    commitment: "confirmed",
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }),
  }));
}
function getProgramId(): PublicKey {
  return (_programId ??= new PublicKey(TRADE_ENV.programId));
}

const U64_MAX = (1n << 64n) - 1n;

type ParsedTxMessage = {
  accountKeys?: PublicKey[];
  staticAccountKeys?: PublicKey[];
  compiledInstructions: Array<{
    programIdIndex: number;
    accountKeyIndexes: number[];
    data: Uint8Array;
  }>;
};

function getAccountKeys(message: ParsedTxMessage): PublicKey[] {
  return message.accountKeys ?? message.staticAccountKeys ?? [];
}

function instructionMatchesTransaction(
  instruction: ParsedTxMessage["compiledInstructions"][0],
  accountKeys: PublicKey[],
  expectedData: Buffer,
  programId: PublicKey,
  dealPda: PublicKey,
): boolean {
  const programMatches = accountKeys[instruction.programIdIndex]?.equals(programId);
  const dataMatches = Buffer.compare(Buffer.from(instruction.data), expectedData) === 0;
  const pdaMatches = instruction.accountKeyIndexes.some((i) => accountKeys[i]?.equals(dealPda));
  return Boolean(programMatches && dataMatches && pdaMatches);
}

async function verifyOnChainInstruction(
  txSignature: string,
  expectedData: Buffer,
  dealPda: PublicKey,
): Promise<void> {
  const connection = getConnection();
  const progId = getProgramId();
  let tx;
  try {
    tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    throw new BadRequestException("交易签名无效或尚未上链");
  }
  if (!tx || tx.meta?.err) {
    throw new BadRequestException("交易未在链上确认");
  }
  const message = tx.transaction.message as ParsedTxMessage;
  const keys = getAccountKeys(message);
  const found = message.compiledInstructions.some((ix) =>
    instructionMatchesTransaction(ix, keys, expectedData, progId, dealPda),
  );
  if (!found) {
    throw new BadRequestException("交易不包含预期的合约指令");
  }
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createTrade(
    dto: CreateTradeDto,
    userId: string,
  ): Promise<CreateTradeResponseDto> {
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!buyer) throw new ForbiddenException("登录用户不存在");
    if (buyer.wallet !== dto.buyerWallet) {
      throw new ForbiddenException("buyer wallet does not match the signed-in user");
    }

    const amount = this.parseU64(dto.amount, "amount");
    const tenorDays = this.parseU64(dto.tenor, "tenor");
    if (amount <= 0n) throw new BadRequestException("amount must be greater than zero");
    if (!isValidTenor(tenorDays)) {
      throw new BadRequestException("tenor must be 30, 60, 90, or 120 days");
    }

    const downPayment = (amount * DOWN_PAYMENT_BPS) / BPS_BASE;
    const poolPortion = amount - downPayment;

    const existing = await this.prisma.tradeDeal.findFirst({
      where: {
        buyerWallet: dto.buyerWallet,
        sellerWallet: dto.sellerWallet,
        amount,
        tenor: tenorDays,
        status: "PENDING",
      },
      select: { dealId: true },
    });
    if (existing) {
      const cached = deriveDealPda(
        getProgramId(),
        this.parsePubkey(dto.buyerWallet, "buyerWallet"),
        existing.dealId,
      );
      return {
        tradeId: existing.dealId.toString(10),
        transaction: "",
        blockhash: "",
        dealPda: cached.toBase58(),
        downPayment: downPayment.toString(10),
        poolPortion: poolPortion.toString(10),
        duplicate: true,
      };
    }

    const tradeId = generateTradeId();

    const buyerPubkey = this.parsePubkey(dto.buyerWallet, "buyerWallet");
    const sellerPubkey = this.parsePubkey(dto.sellerWallet, "sellerWallet");
    const usdcMint = new PublicKey(TRADE_ENV.usdcMint);

    const { transaction, blockhash } = await buildCreateDealTransaction(
      {
        id: tradeId,
        buyer: buyerPubkey,
        seller: sellerPubkey,
        amount,
        tenorDays,
        buyerTokenAccount: deriveAssociatedTokenAccount(buyerPubkey, usdcMint),
        usdcMint,
      },
      getConnection(),
    );

    return {
      tradeId: tradeId.toString(10),
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      dealPda: deriveDealPda(getProgramId(), buyerPubkey, tradeId).toBase58(),
      downPayment: downPayment.toString(10),
      poolPortion: poolPortion.toString(10),
    };
  }

  async listMyTrades(userId: string): Promise<TradeItemDto[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const wallet = user?.wallet;
    let where: Prisma.TradeDealWhereInput;
    if (wallet) {
      where = { OR: [{ buyerWallet: wallet }, { sellerWallet: wallet }] };
    } else {
      where = { buyer: { id: userId } };
    }
    const trades = await this.prisma.tradeDeal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return trades.map((trade) => ({
      id: trade.id,
      tradeId: trade.dealId.toString(10),
      buyerWallet: trade.buyerWallet,
      sellerWallet: trade.sellerWallet,
      amount: trade.amount.toString(10),
      downPayment: trade.downPayment.toString(10),
      poolPortion: trade.poolPortion.toString(10),
      tenor: Number(trade.tenor),
      status: trade.status,
      txSignature: trade.txSignature,
      logisticsHash: trade.logisticsHash,
      createdAt: trade.createdAt.toISOString(),
    }));
  }

  async confirmTrade(tradeId: string, dto: ConfirmTradeDto, userId: string) {
    let id: bigint;
    try {
      id = BigInt(tradeId);
    } catch {
      throw new BadRequestException("invalid tradeId");
    }
    if (id < 0n) throw new BadRequestException("invalid tradeId");
    if (!dto.txSignature) throw new BadRequestException("txSignature is required");

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException("登录用户不存在");
    if (user.wallet !== dto.buyerWallet) {
      throw new ForbiddenException("buyer wallet does not match the signed-in user");
    }

    const existing = await this.prisma.tradeDeal.findUnique({
      where: { dealId: id },
      select: { id: true, status: true },
    });
    if (existing) {
      return {
        ok: true,
        tradeId: id.toString(10),
        dealPda: existing.id,
        status: existing.status,
      };
    }

    const amount = this.parseU64(dto.amount, "amount");
    const tenorDays = this.parseU64(dto.tenor, "tenor");
    if (amount <= 0n) throw new BadRequestException("amount must be greater than zero");
    if (!isValidTenor(tenorDays)) {
      throw new BadRequestException("tenor must be 30, 60, 90, or 120 days");
    }

    const buyerPubkey = this.parsePubkey(dto.buyerWallet, "buyerWallet");
    const sellerPubkey = this.parsePubkey(dto.sellerWallet, "sellerWallet");
    const progId = getProgramId();
    const dealPda = deriveDealPda(progId, buyerPubkey, id);
    const expectedData = buildCreateDealInstructionData({
      id,
      seller: sellerPubkey,
      amount,
      tenorDays,
    });

    const connection = getConnection();
    let tx;
    try {
      tx = await connection.getTransaction(dto.txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      throw new BadRequestException("交易签名无效或尚未上链");
    }
    if (!tx || tx.meta?.err) {
      throw new BadRequestException("交易未在链上确认");
    }

    const message = tx.transaction.message as ParsedTxMessage;
    const keys = getAccountKeys(message);
    const hasCreateDeal = message.compiledInstructions.some((ix) =>
      instructionMatchesTransaction(ix, keys, expectedData, progId, dealPda),
    );
    if (!hasCreateDeal) {
      throw new BadRequestException("交易不包含预期的 create_deal 指令");
    }

    const downPayment = (amount * DOWN_PAYMENT_BPS) / BPS_BASE;
    const poolPortion = amount - downPayment;
    const buyer = await this.upsertUser(dto.buyerWallet);
    const seller = await this.upsertUser(dto.sellerWallet);
    const data: Prisma.TradeDealCreateInput = {
      id: dealPda.toBase58(),
      dealId: id,
      buyer: { connect: { id: buyer.id } },
      seller: { connect: { id: seller.id } },
      buyerWallet: dto.buyerWallet,
      sellerWallet: dto.sellerWallet,
      amount,
      downPayment,
      poolPortion,
      tenor: tenorDays,
      status: "PENDING",
      createdAt: new Date(),
      txSignature: dto.txSignature,
      logisticsHash: dto.logisticsHash ?? null,
    };

    const updateData = {
      id: data.id,
      buyer: data.buyer,
      seller: data.seller,
      buyerWallet: data.buyerWallet,
      sellerWallet: data.sellerWallet,
      amount: data.amount,
      downPayment: data.downPayment,
      poolPortion: data.poolPortion,
      tenor: data.tenor,
      status: data.status,
      txSignature: data.txSignature,
    };
    let deal;
    try {
      deal = await this.prisma.tradeDeal.upsert({
        where: { dealId: id },
        create: data,
        update: updateData,
      });
    } catch (error) {
      // indexer may have created the same PDA concurrently; converge by id.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        deal = await this.prisma.tradeDeal.update({
          where: { id: data.id },
          data: updateData,
        });
      } else {
        throw error;
      }
    }
    await this.audit.record({
      actorId: userId,
      action: "TRADE_CREATED",
      targetType: "TRADE",
      targetId: tradeId,
      metadata: { status: deal.status },
    });

    return {
      ok: true,
      tradeId: deal.dealId.toString(10),
      dealPda: deal.id,
      status: deal.status,
    };
  }

  async buildFundTrade(tradeId: string, body: { adminWallet: string }, userId: string) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    let admin: PublicKey;
    try {
      admin = new PublicKey(body.adminWallet);
    } catch {
      throw new BadRequestException("invalid admin wallet");
    }
    const { transaction, blockhash } = await buildFundDealTransaction(
      { tradeId: BigInt(tradeId), buyer: new PublicKey(trade.buyerWallet), admin },
      getConnection(),
    );
    return {
      tradeId,
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      message: "请确认钱包弹窗，签署资金池拨款交易",
    };
  }

  async confirmFundTrade(tradeId: string, body: ConfirmSignatureDto, userId: string) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    if (trade.status !== "PENDING") {
      throw new BadRequestException("only PENDING deals can be funded");
    }
    const buyerPubkey = new PublicKey(trade.buyerWallet);
    const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
    await verifyOnChainInstruction(
      body.txSignature,
      buildFundDealInstructionData(BigInt(tradeId)),
      dealPda,
    );
    const updated = await this.prisma.tradeDeal.update({
      where: { dealId: BigInt(tradeId) },
      data: { status: "FUNDED", txSignature: body.txSignature },
    });
    await this.audit.record({
      actorId: userId,
      action: "TRADE_FUNDED",
      targetType: "TRADE",
      targetId: tradeId,
    });
    return { ok: true, tradeId, status: updated.status };
  }

  async buildAdvanceTrade(tradeId: string, dto: AdvanceTradeDto, userId: string) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    const targetStatus = this.parseTargetStatus(dto.targetStatus);
    let admin: PublicKey;
    try {
      admin = new PublicKey(dto.adminWallet);
    } catch {
      throw new BadRequestException("invalid admin wallet");
    }
    const { transaction, blockhash } = await buildAdvanceDealTransaction(
      {
        tradeId: BigInt(tradeId),
        buyer: new PublicKey(trade.buyerWallet),
        admin,
        targetStatus,
      },
      getConnection(),
    );
    return {
      tradeId,
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      targetStatus,
      message: "请确认钱包弹窗，签署物流状态推进交易",
    };
  }

  async confirmAdvanceTrade(
    tradeId: string,
    dto: AdvanceTradeDto & ConfirmSignatureDto,
    userId: string,
  ) {
    if (!dto.txSignature) throw new BadRequestException("txSignature is required");
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    if (!["FUNDED", "IN_TRANSIT", "CUSTOMS_CLEAR", "DELIVERED"].includes(trade.status)) {
      throw new BadRequestException(`cannot advance deal from status ${trade.status}`);
    }
    const targetStatus = this.parseTargetStatus(dto.targetStatus);
    const buyerPubkey = new PublicKey(trade.buyerWallet);
    const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
    await verifyOnChainInstruction(
      dto.txSignature,
      buildAdvanceDealInstructionData(BigInt(tradeId), targetStatus),
      dealPda,
    );
    const status = TARGET_STATUS_BY_CODE[targetStatus];
    const updated = await this.prisma.tradeDeal.update({
      where: { dealId: BigInt(tradeId) },
      data: { status: status as DealStatus, txSignature: dto.txSignature },
    });
    await this.audit.record({
      actorId: userId,
      action: "TRADE_ADVANCED",
      targetType: "TRADE",
      targetId: tradeId,
      metadata: { targetStatus },
    });
    return { ok: true, tradeId, status: updated.status };
  }

  async buildRepayTrade(tradeId: string, userId: string) {
    const trade = await this.requireBuyerDeal(tradeId, userId);
    const { transaction, blockhash } = await buildRepayDealTransaction(
      {
        tradeId: BigInt(tradeId),
        buyer: new PublicKey(trade.buyerWallet),
        usdcMint: new PublicKey(TRADE_ENV.usdcMint),
      },
      getConnection(),
    );
    return {
      tradeId,
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      message: "请确认钱包弹窗，签署本金与费用还款交易",
    };
  }

  async confirmRepayTrade(tradeId: string, body: ConfirmSignatureDto, userId: string) {
    const trade = await this.requireBuyerDeal(tradeId, userId);
    if (trade.status !== "REPAYING") {
      throw new BadRequestException("only REPAYING deals can be repaid");
    }
    const buyerPubkey = new PublicKey(trade.buyerWallet);
    const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
    await verifyOnChainInstruction(
      body.txSignature,
      buildRepayDealInstructionData(BigInt(tradeId)),
      dealPda,
    );
    const updated = await this.prisma.tradeDeal.update({
      where: { dealId: BigInt(tradeId) },
      data: { status: "SETTLED", repaidAt: new Date(), txSignature: body.txSignature },
    });
    await this.audit.record({
      actorId: userId,
      action: "TRADE_REPAID",
      targetType: "TRADE",
      targetId: tradeId,
    });
    return { ok: true, tradeId, status: updated.status };
  }

  async buildDefaultTrade(
    tradeId: string,
    body: { adminWallet: string },
    userId: string,
  ) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    let admin: PublicKey;
    try {
      admin = new PublicKey(body.adminWallet);
    } catch {
      throw new BadRequestException("invalid admin wallet");
    }
    const { transaction, blockhash } = await buildDefaultDealTransaction(
      {
        tradeId: BigInt(tradeId),
        buyer: new PublicKey(trade.buyerWallet),
        admin,
      },
      getConnection(),
    );
    return {
      tradeId,
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      message: "请确认钱包弹窗，签署违约清算交易",
    };
  }

  async confirmDefaultTrade(
    tradeId: string,
    body: ConfirmSignatureDto,
    userId: string,
  ) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    if (!["FUNDED", "IN_TRANSIT", "CUSTOMS_CLEAR", "DELIVERED"].includes(trade.status)) {
      throw new BadRequestException(`cannot default deal from status ${trade.status}`);
    }
    const dealPda = deriveDealPda(
      getProgramId(),
      new PublicKey(trade.buyerWallet),
      BigInt(tradeId),
    );
    await verifyOnChainInstruction(
      body.txSignature,
      buildDefaultDealInstructionData(BigInt(tradeId)),
      dealPda,
    );
    const updated = await this.prisma.tradeDeal.update({
      where: { dealId: BigInt(tradeId) },
      data: {
        status: "DEFAULTED",
        txSignature: body.txSignature,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: "TRADE_DEFAULTED",
      targetType: "TRADE",
      targetId: tradeId,
    });
    return { ok: true, tradeId, status: updated.status };
  }

  async buildReleaseTrade(
    tradeId: string,
    body: { adminWallet: string },
    userId: string,
  ) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    let admin: PublicKey;
    try {
      admin = new PublicKey(body.adminWallet);
    } catch {
      throw new BadRequestException("invalid admin wallet");
    }
    const { transaction, blockhash } = await buildReleaseToSellerTransaction(
      {
        tradeId: BigInt(tradeId),
        buyer: new PublicKey(trade.buyerWallet),
        seller: new PublicKey(trade.sellerWallet),
        admin,
      },
      getConnection(),
    );
    return {
      tradeId,
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      message: "请确认钱包弹窗，签署释放托管资金交易",
    };
  }

  async confirmReleaseTrade(
    tradeId: string,
    body: ConfirmSignatureDto,
    userId: string,
  ) {
    const trade = await this.requireAdminAndDeal(tradeId, userId);
    const dealPda = deriveDealPda(
      getProgramId(),
      new PublicKey(trade.buyerWallet),
      BigInt(tradeId),
    );
    await verifyOnChainInstruction(
      body.txSignature,
      buildReleaseToSellerInstructionData(BigInt(tradeId)),
      dealPda,
    );
    const updated = await this.prisma.tradeDeal.update({
      where: { dealId: BigInt(tradeId) },
      data: { status: "REPAYING", txSignature: body.txSignature },
    });
    await this.audit.record({
      actorId: userId,
      action: "TRADE_RELEASED",
      targetType: "TRADE",
      targetId: tradeId,
    });
    return { ok: true, tradeId, status: updated.status };
  }

  private async requireAdminAndDeal(tradeId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      throw new ForbiddenException("仅管理员可执行此操作");
    }
    const dealId = this.parseTradeId(tradeId);
    const trade = await this.prisma.tradeDeal.findUnique({
      where: { dealId },
    });
    if (!trade) throw new NotFoundException("trade not found");
    return trade;
  }

  private async requireBuyerDeal(tradeId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.wallet) throw new ForbiddenException("登录用户未绑定钱包");
    const dealId = this.parseTradeId(tradeId);
    const trade = await this.prisma.tradeDeal.findUnique({
      where: { dealId },
    });
    if (!trade) throw new NotFoundException("trade not found");
    if (trade.buyerWallet !== user.wallet) {
      throw new ForbiddenException("仅订单买方可执行还款");
    }
    return trade;
  }

  private parseTargetStatus(value: string): number {
    const status = Number(value);
    if (!Number.isInteger(status) || !(status in TARGET_STATUS_BY_CODE)) {
      throw new BadRequestException("targetStatus must be 2, 3, 4, or 5");
    }
    return status;
  }

  private parsePubkey(value: string, field: string): PublicKey {
    try {
      return new PublicKey(value);
    } catch {
      throw new BadRequestException(`invalid ${field}`);
    }
  }

  private parseU64(value: string, field: string): bigint {
    try {
      const parsed = BigInt(value);
      if (parsed < 0n || parsed > U64_MAX) {
        throw new Error("out of range");
      }
      return parsed;
    } catch {
      throw new BadRequestException(`invalid ${field}`);
    }
  }

  private parseTradeId(value: string): bigint {
    try {
      const id = BigInt(value);
      if (id < 0n) {
        throw new Error("negative");
      }
      return id;
    } catch {
      throw new BadRequestException("invalid tradeId");
    }
  }

  private async upsertUser(wallet: string) {
    return this.prisma.user.upsert({
      where: { wallet },
      create: { wallet },
      update: {},
    });
  }
}

const TARGET_STATUS_BY_CODE: Record<number, string> = {
  2: "IN_TRANSIT",
  3: "CUSTOMS_CLEAR",
  4: "DELIVERED",
  5: "REPAYING",
};
