import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type DealStatus } from "@prisma/client";
import { Connection, MessageV0, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { TRADE_ENV } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RedisService, pickRpcUrl } from "@supply-chain/common";
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

const _connections = new Map<string, Connection>();
let _programId: PublicKey | undefined;

function getConnection(): Connection {
  const url = pickRpcUrl(TRADE_ENV.rpcUrl);
  let conn = _connections.get(url);
  if (!conn) {
    conn = new Connection(url, {
      commitment: "confirmed",
      fetch: (fetchUrl, options) =>
        fetch(fetchUrl, { ...options, signal: AbortSignal.timeout(30_000) }),
    });
    _connections.set(url, conn);
  }
  return conn;
}
function getProgramId(): PublicKey {
  return (_programId ??= new PublicKey(TRADE_ENV.programId));
}

const U64_MAX = (1n << 64n) - 1n;

// 列表/详情只取响应需要的字段，避免把整段 rawData(Json) 从数据库拉出来。
const TRADE_LIST_SELECT = {
  id: true,
  dealId: true,
  buyerWallet: true,
  sellerWallet: true,
  amount: true,
  downPayment: true,
  poolPortion: true,
  tenor: true,
  status: true,
  txSignature: true,
  logisticsHash: true,
  createdAt: true,
} satisfies Prisma.TradeDealSelect;

type ParsedTxMessage = {
  accountKeys?: PublicKey[];
  staticAccountKeys?: PublicKey[];
  compiledInstructions: Array<{
    programIdIndex: number;
    accountKeyIndexes: number[];
    data: Uint8Array;
  }>;
};

function getAccountKeys(message: MessageV0 | { accountKeys: PublicKey[] }): PublicKey[] {
  if ("accountKeys" in message) return message.accountKeys;
  return message.staticAccountKeys;
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
  const message = tx.transaction.message as MessageV0 | { accountKeys: PublicKey[]; compiledInstructions: Array<{ programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array }> };
  const keys = getAccountKeys(message);
  const found = message.compiledInstructions.some((ix) =>
    instructionMatchesTransaction(ix, keys, expectedData, progId, dealPda),
  );
  if (!found) {
    throw new BadRequestException("交易不包含预期的合约指令");
  }
}

// TradeDeal 账户布局：discriminator(8) + id(8) + buyer(32) + seller(32)
// + amount(8) + down_payment(8) + pool_portion(8) + tenor(8) + status(1)。
const TRADE_STATUS_OFFSET = 8 + 8 + 32 + 32 + 8 + 8 + 8 + 8;
const CHAIN_STATUS_TO_DEAL: Record<number, DealStatus> = {
  0: "PENDING",
  1: "FUNDED",
  2: "IN_TRANSIT",
  3: "CUSTOMS_CLEAR",
  4: "DELIVERED",
  5: "REPAYING",
  6: "SETTLED",
  7: "DEFAULTED",
};

async function fetchOnChainDealStatus(
  dealPda: PublicKey,
): Promise<DealStatus | null> {
  const connection = getConnection();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const info = await connection.getAccountInfo(dealPda, "confirmed");
    if (info && info.data.length > TRADE_STATUS_OFFSET) {
      return CHAIN_STATUS_TO_DEAL[info.data[TRADE_STATUS_OFFSET]] ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function requireOnChainStatus(
  dealPda: PublicKey,
  expected: DealStatus,
): Promise<DealStatus> {
  const onChain = await fetchOnChainDealStatus(dealPda);
  if (onChain !== expected) {
    throw new BadRequestException(
      `链上订单状态为 ${onChain ?? "unknown"}，期望 ${expected}，请勿使用过期签名回退状态`,
    );
  }
  return onChain;
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private async withConfirmLock<T>(tradeId: string, run: () => Promise<T>): Promise<T> {
    const key = `trade:confirm:${this.normalizeTradeId(tradeId)}`;
    const acquired = await this.redis.setNX(key, "1", 60);
    if (!acquired) {
      throw new ConflictException("该订单正在处理中，请勿重复提交");
    }
    try {
      return await run();
    } finally {
      await this.redis.del(key);
    }
  }

  async createTrade(
    dto: CreateTradeDto,
    userId: string,
    idempotencyKey?: string,
  ): Promise<CreateTradeResponseDto> {
    const idemKey = idempotencyKey
      ? `trade:idem:${userId}:${createHash("sha256").update(idempotencyKey).digest("hex")}`
      : undefined;
    if (idemKey) {
      const cached = await this.redis.get(idemKey);
      if (cached) {
        try {
          return JSON.parse(cached) as CreateTradeResponseDto;
        } catch {
          // 缓存损坏时忽略并重新构建。
        }
      }
    }

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
        tenor: tenorDays * 86_400n,
        status: "PENDING",
      },
      select: { dealId: true },
    });
    if (existing) {
      const cached = deriveDealPda(
        getProgramId(),
        this.parsePubkey(dto.buyerWallet, "buyerWallet"),
        BigInt(existing.dealId),
      );
      const duplicateResponse: CreateTradeResponseDto = {
        tradeId: existing.dealId,
        transaction: "",
        blockhash: "",
        dealPda: cached.toBase58(),
        downPayment: downPayment.toString(10),
        poolPortion: poolPortion.toString(10),
        duplicate: true,
      };
      if (idemKey) {
        await this.redis
          .setWithExpiry(idemKey, JSON.stringify(duplicateResponse), 86_400)
          .catch(() => undefined);
      }
      return duplicateResponse;
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

    const response: CreateTradeResponseDto = {
      tradeId: tradeId.toString(10),
      transaction: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash,
      dealPda: deriveDealPda(getProgramId(), buyerPubkey, tradeId).toBase58(),
      downPayment: downPayment.toString(10),
      poolPortion: poolPortion.toString(10),
    };
    if (idemKey) {
      await this.redis
        .setWithExpiry(idemKey, JSON.stringify(response), 86_400)
        .catch(() => undefined);
    }
    return response;
  }

  async listMyTrades(
    userId: string,
    params: { search?: string; status?: string } = {},
  ): Promise<TradeItemDto[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const wallet = user?.wallet;
    let where: Prisma.TradeDealWhereInput;
    if (wallet) {
      where = { OR: [{ buyerWallet: wallet }, { sellerWallet: wallet }] };
    } else {
      where = { buyer: { id: userId } };
    }
    where = this.applyTradeFilters(where, params);
    const trades = await this.prisma.tradeDeal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: TRADE_LIST_SELECT,
    });
    return trades.map((trade) => ({
      id: trade.id,
      tradeId: trade.dealId,
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

  async listAllTrades(
    userId: string,
    params: { search?: string; status?: string } = {},
  ): Promise<TradeItemDto[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      throw new ForbiddenException("仅管理员可查看全部订单");
    }
    const where: Prisma.TradeDealWhereInput = this.applyTradeFilters({}, params);
    const trades = await this.prisma.tradeDeal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: TRADE_LIST_SELECT,
    });
    return trades.map((trade) => ({
      id: trade.id,
      tradeId: trade.dealId,
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

  async getTrade(tradeId: string, userId: string): Promise<TradeItemDto> {
    const id = this.parseTradeId(tradeId);
    const trade = await this.prisma.tradeDeal.findUnique({
      where: { dealId: id.toString(10) },
      select: TRADE_LIST_SELECT,
    });
    if (!trade) throw new NotFoundException("trade not found");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new ForbiddenException("登录用户不存在");
    if (
      user.role !== "ADMIN" &&
      user.wallet !== trade.buyerWallet &&
      user.wallet !== trade.sellerWallet
    ) {
      throw new ForbiddenException("无权查看此订单");
    }
    return {
      id: trade.id,
      tradeId: trade.dealId,
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
    };
  }

  private applyTradeFilters(
    where: Prisma.TradeDealWhereInput,
    params: { search?: string; status?: string },
  ): Prisma.TradeDealWhereInput {
    const filters: Prisma.TradeDealWhereInput = {};
    const search = params.search?.trim();
    if (search) {
      filters.OR = [
        { dealId: { contains: search } },
        { buyerWallet: { contains: search } },
        { sellerWallet: { contains: search } },
      ];
    }
    const status = params.status?.trim().toUpperCase();
    if (status) {
      filters.status = status as DealStatus;
    }
    if (Object.keys(filters).length === 0) return where;
    if (Object.keys(where).length === 0) return filters;
    return { AND: [where, filters] };
  }

  async confirmTrade(tradeId: string, dto: ConfirmTradeDto, userId: string) {
    return this.withConfirmLock(tradeId, async () => {
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
          where: { dealId: id.toString(10) },
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
        const keys = getAccountKeys(message as unknown as MessageV0 | { accountKeys: PublicKey[] });
        const hasCreateDeal = message.compiledInstructions.some((ix) =>
          instructionMatchesTransaction(ix, keys, expectedData, progId, dealPda),
        );
        if (!hasCreateDeal) {
          throw new BadRequestException("交易不包含预期的 create_deal 指令");
        }
        await requireOnChainStatus(dealPda, "PENDING");

        const downPayment = (amount * DOWN_PAYMENT_BPS) / BPS_BASE;
        const poolPortion = amount - downPayment;
        const buyer = await this.upsertUser(dto.buyerWallet);
        const seller = await this.upsertUser(dto.sellerWallet);
        const data: Prisma.TradeDealCreateInput = {
          id: dealPda.toBase58(),
          dealId: id.toString(10),
          buyer: { connect: { id: buyer.id } },
          seller: { connect: { id: seller.id } },
          buyerWallet: dto.buyerWallet,
          sellerWallet: dto.sellerWallet,
          amount,
          downPayment,
          poolPortion,
          tenor: tenorDays * 86_400n,
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
            where: { dealId: id.toString(10) },
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
          tradeId: deal.dealId,
          dealPda: deal.id,
          status: deal.status,
        };
  });
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
    return this.withConfirmLock(tradeId, async () => {
        const trade = await this.requireAdminAndDeal(tradeId, userId);
        if (trade.status !== "PENDING" && trade.status !== "FUNDED") {
          throw new BadRequestException("only PENDING deals can be funded");
        }
        const buyerPubkey = new PublicKey(trade.buyerWallet);
        const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
        await verifyOnChainInstruction(
          body.txSignature,
          buildFundDealInstructionData(BigInt(tradeId)),
          dealPda,
        );
        await requireOnChainStatus(dealPda, "FUNDED");
        const updated = await this.prisma.tradeDeal.update({
          where: { dealId: this.normalizeTradeId(tradeId) },
          data: { status: "FUNDED", txSignature: body.txSignature },
        });
        await this.audit.record({
          actorId: userId,
          action: "TRADE_FUNDED",
          targetType: "TRADE",
          targetId: tradeId,
        });
        return { ok: true, tradeId, status: updated.status };
  });
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
    return this.withConfirmLock(tradeId, async () => {
        if (!dto.txSignature) throw new BadRequestException("txSignature is required");
        const trade = await this.requireAdminAndDeal(tradeId, userId);
        const targetStatus = this.parseTargetStatus(dto.targetStatus);
        const targetDealStatus = TARGET_STATUS_BY_CODE[targetStatus] as DealStatus;
        if (
          !["FUNDED", "IN_TRANSIT", "CUSTOMS_CLEAR", "DELIVERED"].includes(trade.status) &&
          trade.status !== targetDealStatus
        ) {
          throw new BadRequestException(`cannot advance deal from status ${trade.status}`);
        }
        const buyerPubkey = new PublicKey(trade.buyerWallet);
        const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
        await verifyOnChainInstruction(
          dto.txSignature,
          buildAdvanceDealInstructionData(BigInt(tradeId), targetStatus),
          dealPda,
        );
        await requireOnChainStatus(dealPda, targetDealStatus);
        const status = TARGET_STATUS_BY_CODE[targetStatus] as DealStatus;
        const updated = await this.prisma.tradeDeal.update({
          where: { dealId: this.normalizeTradeId(tradeId) },
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
  });
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
    return this.withConfirmLock(tradeId, async () => {
        const trade = await this.requireBuyerDeal(tradeId, userId);
        if (trade.status !== "REPAYING" && trade.status !== "SETTLED") {
          throw new BadRequestException("only REPAYING deals can be repaid");
        }
        const buyerPubkey = new PublicKey(trade.buyerWallet);
        const dealPda = deriveDealPda(getProgramId(), buyerPubkey, BigInt(tradeId));
        await verifyOnChainInstruction(
          body.txSignature,
          buildRepayDealInstructionData(BigInt(tradeId)),
          dealPda,
        );
        await requireOnChainStatus(dealPda, "SETTLED");
        const updated = await this.prisma.tradeDeal.update({
          where: { dealId: this.normalizeTradeId(tradeId) },
          data: { status: "SETTLED", repaidAt: new Date(), txSignature: body.txSignature },
        });
        await this.audit.record({
          actorId: userId,
          action: "TRADE_REPAID",
          targetType: "TRADE",
          targetId: tradeId,
        });
        return { ok: true, tradeId, status: updated.status };
  });
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
    return this.withConfirmLock(tradeId, async () => {
        const trade = await this.requireAdminAndDeal(tradeId, userId);
        if (!["FUNDED", "IN_TRANSIT", "CUSTOMS_CLEAR", "DELIVERED", "REPAYING", "DEFAULTED"].includes(trade.status)) {
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
        await requireOnChainStatus(dealPda, "DEFAULTED");
        const updated = await this.prisma.tradeDeal.update({
          where: { dealId: this.normalizeTradeId(tradeId) },
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
  });
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
    return this.withConfirmLock(tradeId, async () => {
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
        await requireOnChainStatus(dealPda, "REPAYING");
        const updated = await this.prisma.tradeDeal.update({
          where: { dealId: this.normalizeTradeId(tradeId) },
          data: { status: "REPAYING", txSignature: body.txSignature },
        });
        await this.audit.record({
          actorId: userId,
          action: "TRADE_RELEASED",
          targetType: "TRADE",
          targetId: tradeId,
        });
        return { ok: true, tradeId, status: updated.status };
  });
  }

  private async requireAdminAndDeal(tradeId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") {
      throw new ForbiddenException("仅管理员可执行此操作");
    }
    this.parseTradeId(tradeId);
    const trade = await this.prisma.tradeDeal.findUnique({
      where: { dealId: this.normalizeTradeId(tradeId) },
    });
    if (!trade) throw new NotFoundException("trade not found");
    return trade;
  }

  private async requireBuyerDeal(tradeId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.wallet) throw new ForbiddenException("登录用户未绑定钱包");
    this.parseTradeId(tradeId);
    const trade = await this.prisma.tradeDeal.findUnique({
      where: { dealId: this.normalizeTradeId(tradeId) },
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

  private normalizeTradeId(value: string): string {
    return this.parseTradeId(value).toString(10);
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
