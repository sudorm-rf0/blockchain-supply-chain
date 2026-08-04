import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Keypair } from "@solana/web3.js";
import { AttestationService } from "./attestation.service";

function makePrisma(file?: Record<string, unknown> | null) {
  return {
    file: {
      findUnique: jest.fn(async () => file ?? null),
      update: jest.fn(async ({ data }) => ({ id: "f1", ...data })),
    },
    tradeDeal: {
      findUnique: jest.fn(async () => ({
        dealId: "42",
        buyerWallet: "buyer-wallet",
        sellerWallet: "seller-wallet",
      })),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: "user-1",
        wallet: "user-wallet",
      })),
      update: jest.fn(async ({ data }) => ({ id: "user-1", ...data })),
    },
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("AttestationService", () => {
  const wallet = Keypair.generate().publicKey.toBase58();

  it("rejects attestation for a missing file", async () => {
    const service = new AttestationService(
      makePrisma(null) as never,
      makeAudit() as never,
    );
    await expect(
      service.build("missing", "user-1", { walletAddress: wallet }),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects attestation by a non-owner", async () => {
    const service = new AttestationService(
      makePrisma({ id: "f1", uploaderId: "owner-1" }) as never,
      makeAudit() as never,
    );
    await expect(
      service.build("f1", "user-1", { walletAddress: wallet }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects attestation for an already attested file", async () => {
    const service = new AttestationService(
      makePrisma({ id: "f1", uploaderId: "user-1", txSignature: "sig" }) as never,
      makeAudit() as never,
    );
    await expect(
      service.build("f1", "user-1", { walletAddress: wallet }),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects a trade id that differs from the file trade", async () => {
    const service = new AttestationService(
      makePrisma({
        id: "f1",
        uploaderId: "user-1",
        tradeId: "42",
        hash: "a".repeat(64),
        path: "/uploads/a.png",
      }) as never,
      makeAudit() as never,
    );
    await expect(
      service.build("f1", "user-1", {
        walletAddress: wallet,
        tradeId: "43",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an invalid wallet address", async () => {
    const service = new AttestationService(
      makePrisma({ id: "f1", uploaderId: "user-1" }) as never,
      makeAudit() as never,
    );
    await expect(
      service.build("f1", "user-1", { walletAddress: "not-a-wallet" }),
    ).rejects.toThrow(BadRequestException);
  });
});
