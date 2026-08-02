import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Connection, PublicKey } from "@solana/web3.js";
import { TRADE_ENV } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import { ConfirmTradeDto } from "./dto/confirm-trade.dto";
import { TradeItemDto } from "./dto/trade-item.dto";
import {
  BPS_BASE,
  DOWN_PAYMENT_BPS,
  buildCreateDealInstructionData,
  buildCreateDealTransaction,
  deriveAssociatedTokenAccount,
  deriveDealPda,
  generateTradeId,
  isValidTenor,
} from "./solana/tx-builder";

@Injectable()
export class TradesService {
  constructor(private readonly prisma: PrismaService) {}

  async createTrade(
    dto: CreateTradeDto,
    userId: string,
  ): Promise<CreateTradeResponseDto> {
    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!buyer) {
      throw new ForbiddenException("登录用户不存在");
    }
    if (buyer.wallet !== dto.buyerWallet) {
      throw new ForbiddenException(
        "buyer wallet does not match the signed-in user",
      );
    }

    const amount = BigInt(dto.amount);
    const tenorDays = BigInt(dto.tenor);
    if (amount <= 0n) {
      throw new BadRequestException("amount must be greater than zero");
    }
    if (!isValidTenor(tenorDays)) {
      throw new BadRequestException("tenor must be 30, 60, 90, or 120 days");
    }

    // Match contract rounding: pool_portion = amount - floor(amount * 30 / 100)
    const downPayment = (amount * DOWN_PAYMENT_BPS) / BPS_BASE;
    const poolPortion = amount - downPayment;
    const tradeId = generateTradeId();

    const buyerPubkey = new PublicKey(dto.buyerWallet);
    const sellerPubkey = new PublicKey(dto.sellerWallet);
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
      new Connection(TRADE_ENV.rpcUrl, "confirmed"),
    );

    const serialized = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return {
      tradeId: tradeId.toString(10),
      transaction: serialized,
      blockhash,
      dealPda: deriveDealPda(
        new PublicKey(TRADE_ENV.programId),
        buyerPubkey,
        tradeId,
      ).toBase58(),
      downPayment: downPayment.toString(10),
      poolPortion: poolPortion.toString(10),
    };
  }

  async listMyTrades(userId: string): Promise<TradeItemDto[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user?.wallet) {
      return [];
    }
    const trades = await this.prisma.tradeDeal.findMany({
      where: {
        OR: [{ buyerWallet: user.wallet }, { sellerWallet: user.wallet }],
      },
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

  async confirmTrade(
    tradeId: string,
    dto: ConfirmTradeDto,
    userId: string,
  ) {
    let id: bigint;
    try {
      id = BigInt(tradeId);
    } catch {
      throw new BadRequestException("invalid tradeId");
    }
    if (id < 0n) {
      throw new BadRequestException("invalid tradeId");
    }
    if (!dto.txSignature) {
      throw new BadRequestException("txSignature is required");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new ForbiddenException("登录用户不存在");
    }
    if (user.wallet !== dto.buyerWallet) {
      throw new ForbiddenException(
        "buyer wallet does not match the signed-in user",
      );
    }

    const amount = BigInt(dto.amount);
    const tenorDays = BigInt(dto.tenor);
    if (amount <= 0n) {
      throw new BadRequestException("amount must be greater than zero");
    }
    if (!isValidTenor(tenorDays)) {
      throw new BadRequestException("tenor must be 30, 60, 90, or 120 days");
    }

    const buyerPubkey = new PublicKey(dto.buyerWallet);
    const sellerPubkey = new PublicKey(dto.sellerWallet);
    const programId = new PublicKey(TRADE_ENV.programId);
    const dealPda = deriveDealPda(programId, buyerPubkey, id);
    const expectedData = buildCreateDealInstructionData({
      id,
      seller: sellerPubkey,
      amount,
      tenorDays,
    });

    const connection = new Connection(TRADE_ENV.rpcUrl, "confirmed");
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

    const message = tx.transaction.message as {
      accountKeys?: PublicKey[];
      staticAccountKeys?: PublicKey[];
      compiledInstructions: Array<{
        programIdIndex: number;
        accountKeyIndexes: number[];
        data: Uint8Array;
      }>;
    };
    const accountKeys = message.accountKeys ?? message.staticAccountKeys ?? [];
    const hasCreateDeal = message.compiledInstructions.some((instruction) => {
      const programMatches =
        accountKeys[instruction.programIdIndex]?.equals(programId);
      const dataMatches =
        Buffer.compare(Buffer.from(instruction.data), expectedData) === 0;
      const pdaMatches = instruction.accountKeyIndexes.some(
        (index) => accountKeys[index]?.equals(dealPda),
      );
      return Boolean(programMatches && dataMatches && pdaMatches);
    });
    if (!hasCreateDeal) {
      throw new BadRequestException(
        "交易不包含预期的 create_deal 指令",
      );
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
      logisticsHash: null,
    };

    const deal = await this.prisma.tradeDeal.upsert({
      where: { dealId: id },
      create: data,
      update: {
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
      },
    });

    return {
      ok: true,
      tradeId: deal.dealId.toString(10),
      dealPda: deal.id,
      status: deal.status,
    };
  }

  private async upsertUser(wallet: string) {
    return this.prisma.user.upsert({
      where: { wallet },
      create: { wallet },
      update: {},
    });
  }
}
