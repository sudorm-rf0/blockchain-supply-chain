import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Connection, PublicKey } from "@solana/web3.js";
import { TRADE_ENV } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTradeDto } from "./dto/create-trade.dto";
import { CreateTradeResponseDto } from "./dto/create-trade-response.dto";
import {
  BPS_BASE,
  DOWN_PAYMENT_BPS,
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
    walletHeader: string | undefined,
  ): Promise<CreateTradeResponseDto> {
    if (!walletHeader || walletHeader !== dto.buyerWallet) {
      throw new UnauthorizedException("x-wallet-address does not match buyer");
    }

    const buyer = await this.prisma.user.findUnique({
      where: { wallet: dto.buyerWallet },
    });
    if (!buyer) {
      throw new ForbiddenException("buyer is not registered");
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
}
