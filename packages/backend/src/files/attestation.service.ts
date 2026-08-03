import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  buildAttestDocumentInstructionData,
  buildAttestDocumentTransaction,
  deriveDealPda,
  deriveDocumentPda,
  getConnection,
  getProgramId,
} from "./solana/document-tx-builder";

@Injectable()
export class AttestationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

    let tradeId = this.parseTradeId(body.tradeId);
    if (file.tradeId && this.parseTradeId(file.tradeId) !== 0n && tradeId !== this.parseTradeId(file.tradeId)) {
      throw new BadRequestException("tradeId does not match the tradeId associated with the file");
    }
    const effectiveTradeId = tradeId !== 0n ? tradeId : this.parseTradeId(file.tradeId);
    let dealPda: PublicKey | null = null;
    if (effectiveTradeId !== 0n) {
      const trade = await this.prisma.tradeDeal.findUnique({
        where: { dealId: effectiveTradeId.toString(10) },
      });
      if (!trade) {
        throw new BadRequestException("trade not found");
      }
      dealPda = deriveDealPda(
        new PublicKey(trade.buyerWallet),
        effectiveTradeId,
      );
    }

    const fileHash = this.parseFileHash(file.hash);
    if (Buffer.byteLength(file.path, "utf8") > 256) {
      throw new BadRequestException("file path is too long for on-chain URI");
    }

    const documentPda = deriveDocumentPda(effectiveTradeId, fileHash);
    const existing = await getConnection().getAccountInfo(
      documentPda,
      "confirmed",
    );
    if (existing) {
      throw new ConflictException("该文件哈希已存证，无需重复上链");
    }

    const { transaction, blockhash } = await buildAttestDocumentTransaction({
      owner,
      tradeId: effectiveTradeId,
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
      documentPda: documentPda.toBase58(),
      message: "请确认钱包弹窗，签署单据哈希存证交易",
    };
  }

  async confirm(
    fileId: string,
    userId: string,
    body: { txSignature?: string; documentPda?: string; tradeId?: string },
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

    const fileHash = this.parseFileHash(file.hash);
    const tradeId = body.tradeId
      ? this.parseTradeId(body.tradeId)
      : this.parseTradeId(file.tradeId);
    const expectedDocumentPda = deriveDocumentPda(tradeId, fileHash);
    if (
      body.documentPda &&
      body.documentPda !== expectedDocumentPda.toBase58()
    ) {
      throw new BadRequestException("document PDA does not match the file hash");
    }

    const connection = getConnection();
    let tx;
    try {
      tx = await connection.getTransaction(body.txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      throw new BadRequestException("交易签名无效或尚未上链");
    }
    if (!tx || tx.meta?.err) {
      throw new BadRequestException("transaction is not confirmed on chain");
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
    const expectedData = buildAttestDocumentInstructionData({
      tradeId,
      fileHash,
      uri: file.path,
    });
    const expectedProgramId = getProgramId();
    const hasAttestInstruction = message.compiledInstructions.some(
      (instruction) => {
        const programMatches = accountKeys[
          instruction.programIdIndex
        ]?.equals(expectedProgramId);
        const dataMatches =
          Buffer.compare(
            Buffer.from(instruction.data),
            expectedData,
          ) === 0;
        const pdaMatches = instruction.accountKeyIndexes.some(
          (index) => accountKeys[index]?.equals(expectedDocumentPda),
        );
        return Boolean(programMatches && dataMatches && pdaMatches);
      },
    );
    if (!hasAttestInstruction) {
      throw new BadRequestException(
        "transaction does not contain the expected attest_document instruction",
      );
    }

    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        txSignature: body.txSignature,
        documentPda: expectedDocumentPda.toBase58(),
        attestedAt: new Date(),
      },
    });

    await this.audit.record({
      actorId: userId,
      action: "FILE_ATTESTED",
      targetType: "FILE",
      targetId: fileId,
      metadata: {
        txSignature: body.txSignature,
        documentPda: expectedDocumentPda.toBase58(),
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
    const walletOwner = await this.prisma.user.findUnique({
      where: { wallet: owner.toBase58() },
      select: { id: true },
    });
    if (walletOwner && walletOwner.id !== user.id) {
      throw new ConflictException("该钱包已被其他用户绑定");
    }
    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { wallet: owner.toBase58() },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new ConflictException("该钱包已被其他用户绑定");
      }
      throw error;
    }
  }

  private parseTradeId(value: string | null | undefined): bigint {
    if (!value || value === "0") return 0n;
    let tradeId: bigint;
    try {
      tradeId = BigInt(value);
    } catch {
      throw new BadRequestException("invalid tradeId");
    }
    if (tradeId < 0n) {
      throw new BadRequestException("invalid tradeId");
    }
    return tradeId;
  }

  private parseFileHash(hash: string): Buffer {
    const fileHash = Buffer.from(hash, "hex");
    if (fileHash.length !== 32) {
      throw new BadRequestException("stored file hash is invalid");
    }
    return fileHash;
  }
}
