import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Connection, PublicKey } from "@solana/web3.js";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildAttestDocumentTransaction,
  deriveDealPda,
  deriveDocumentPda,
  getRpcUrl,
} from "./solana/document-tx-builder";

@Injectable()
export class AttestationService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    fileId: string,
    userId: string,
    body: { walletAddress?: string; tradeId?: string },
  ) {
    if (!body.walletAddress) {
      throw new BadRequestException("walletAddress is required");
    }

    let owner: PublicKey;
    try {
      owner = new PublicKey(body.walletAddress);
    } catch {
      throw new BadRequestException("invalid Solana wallet address");
    }

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new NotFoundException("file not found");
    }
    if (file.uploaderId !== userId) {
      throw new ForbiddenException("no permission to attest this file");
    }
    if (file.txSignature) {
      throw new ConflictException("file already attested on chain");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    await this.ensureWalletBound(user, owner);

    let tradeId = 0n;
    let dealPda: PublicKey | null = null;
    if (body.tradeId && body.tradeId !== "0") {
      try {
        tradeId = BigInt(body.tradeId);
      } catch {
        throw new BadRequestException("invalid tradeId");
      }
      if (tradeId < 0n) {
        throw new BadRequestException("invalid tradeId");
      }
      const trade = await this.prisma.tradeDeal.findUnique({
        where: { dealId: tradeId },
      });
      if (!trade) {
        throw new BadRequestException("trade not found");
      }
      dealPda = deriveDealPda(
        new PublicKey(trade.buyerWallet),
        tradeId,
      );
    }

    const fileHash = Buffer.from(file.hash, "hex");
    if (fileHash.length !== 32) {
      throw new BadRequestException("stored file hash is invalid");
    }
    if (Buffer.byteLength(file.path, "utf8") > 256) {
      throw new BadRequestException("file path is too long for on-chain URI");
    }

    const { transaction, blockhash } = await buildAttestDocumentTransaction({
      owner,
      tradeId,
      fileHash,
      uri: file.path,
      dealPda,
    });

    const serialized = transaction
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString("base64");

    return {
      transaction: serialized,
      blockhash,
      documentPda: deriveDocumentPda(tradeId, fileHash).toBase58(),
      message: "请确认钱包弹窗，签署单据哈希存证交易",
    };
  }

  async confirm(
    fileId: string,
    userId: string,
    body: { txSignature?: string; documentPda?: string },
  ) {
    if (!body.txSignature) {
      throw new BadRequestException("txSignature is required");
    }

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new NotFoundException("file not found");
    }
    if (file.uploaderId !== userId) {
      throw new ForbiddenException("no permission to confirm this file");
    }

    const connection = new Connection(getRpcUrl(), "confirmed");
    const status = await connection.getSignatureStatus(body.txSignature);
    const result = status.value;
    if (!result || result.err) {
      throw new BadRequestException("transaction is not confirmed on chain");
    }

    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        txSignature: body.txSignature,
        documentPda: body.documentPda ?? null,
        attestedAt: new Date(),
      },
    });

    return {
      ok: true,
      id: updated.id,
      txSignature: updated.txSignature,
      documentPda: updated.documentPda,
      attestedAt: updated.attestedAt?.toISOString() ?? null,
    };
  }

  private async ensureWalletBound(
    user:
      | {
          id: string;
          wallet: string | null;
        }
      | null,
    owner: PublicKey,
  ): Promise<void> {
    if (!user) {
      return;
    }
    let bound: PublicKey | null = null;
    if (user.wallet) {
      try {
        bound = new PublicKey(user.wallet);
      } catch {
        bound = null;
      }
    }
    if (bound) {
      if (!bound.equals(owner)) {
        throw new ForbiddenException(
          "wallet does not match the wallet bound to this account",
        );
      }
      return;
    }
    // 首次存证时绑定钱包；旧账号的 wallet 字段可能还是邮箱占位值。
    await this.prisma.user.update({
      where: { id: user.id },
      data: { wallet: owner.toBase58() },
    });
  }
}
