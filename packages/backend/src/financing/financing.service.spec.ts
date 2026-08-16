import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { FinancingService } from "./financing.service";

jest.mock("./solana-verify", () => ({
  verifyUsdcTransfer: jest.fn(),
}));
import { verifyUsdcTransfer } from "./solana-verify";
const mockedVerify = verifyUsdcTransfer as jest.MockedFunction<typeof verifyUsdcTransfer>;

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    financingRequest: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({
        id: "fr-1",
        invoiceId: data.invoiceId,
        invoiceAmount: data.invoiceAmount,
        amount: data.amount,
        discountRate: data.discountRate,
        tenorDays: data.tenorDays,
        status: "PENDING",
        createdAt: new Date(),
        invoice: { filename: "a.pdf", hash: "h" },
      })),
      update: jest.fn(async ({ data }: any) => ({
        id: "fr-1",
        invoiceId: "f1",
        applicantId: "u1",
        invoiceAmount: 1000000n,
        amount: 500000n,
        discountRate: 800,
        tenorDays: 30,
        status: data.status ?? "APPROVED",
        reviewedAt: null,
        repaidAt: null,
        createdAt: new Date(),
        invoice: { filename: "a.pdf", hash: "h" },
        ...data,
      })),
      findMany: jest.fn(async () => []),
    },
    file: {
      findUnique: jest.fn(async () => ({
        id: "f1",
        uploaderId: "u1",
        status: "APPROVED",
        hash: "h",
        filename: "a.pdf",
      })),
    },
  };
  // 覆盖时合并 financingRequest/file 的方法，避免丢失 update 等默认 mock。
  if (overrides.financingRequest) {
    base.financingRequest = { ...base.financingRequest, ...(overrides.financingRequest as any) };
  }
  if (overrides.file) {
    base.file = { ...base.file, ...(overrides.file as any) };
  }
  return { ...base, ...overrides, financingRequest: base.financingRequest, file: base.file };
}

function makeService(prisma: any) {
  const audit = { record: jest.fn(async () => undefined) };
  const turnstile = { verify: jest.fn(async () => true) };
  const service = new FinancingService(prisma as never, audit as never, turnstile as never);
  return { service, audit, turnstile };
}

beforeEach(() => {
  mockedVerify.mockReset();
  mockedVerify.mockResolvedValue(undefined);
  process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
  process.env.USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  process.env.FINANCING_PLATFORM_WALLET = "3rF9fK7hQwQKqVVJnpTTb1PRV3gspkPJXZP8WtZQc4fG";
});

describe("FinancingService 链上证据校验（审计 H-4）", () => {
  it("repay：缺少申请人钱包时拒绝", async () => {
    const prisma = makePrisma({
      financingRequest: {
        findUnique: jest.fn(async () => ({ id: "fr-1", applicantId: "u1", status: "APPROVED", amount: 100n, applicant: { wallet: null } })),
      },
    });
    const { service } = makeService(prisma);
    await expect(service.repay("fr-1", "u1", { txSignature: "sig".repeat(12) } as never)).rejects.toThrow(BadRequestException);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it("repay：链上证据校验失败时拒绝置为已还清", async () => {
    mockedVerify.mockRejectedValueOnce(new BadRequestException("交易不包含预期的 USDC 转账"));
    const prisma = makePrisma({
      financingRequest: {
        findUnique: jest.fn(async () => ({ id: "fr-1", applicantId: "u1", status: "APPROVED", amount: 100n, applicant: { wallet: "8gRg8wBPkT4ej3WPAVDc9nwKYoyypPFjHc2tUreCZM7t" } })),
      },
    });
    const { service } = makeService(prisma);
    await expect(service.repay("fr-1", "u1", { txSignature: "sig".repeat(12) } as never)).rejects.toThrow(BadRequestException);
    // 校验通过前不得更新为 REPAID
    const updateMock = prisma.financingRequest.update as jest.Mock;
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("repay：证据校验通过后置为 REPAID 并记录签名", async () => {
    const prisma = makePrisma({
      financingRequest: {
        findUnique: jest.fn(async () => ({ id: "fr-1", applicantId: "u1", status: "APPROVED", amount: 100n, applicant: { wallet: "8gRg8wBPkT4ej3WPAVDc9nwKYoyypPFjHc2tUreCZM7t" } })),
      },
    });
    const { service } = makeService(prisma);
    const tx = "sig".repeat(12);
    await service.repay("fr-1", "u1", { txSignature: tx } as never);
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    const updateData = (prisma.financingRequest.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.status).toBe("REPAID");
    expect(updateData.repaidTxSignature).toBe(tx);
  });

  it("approve：证据校验通过后置为 APPROVED 并记录放款签名", async () => {
    const prisma = makePrisma({
      financingRequest: {
        findUnique: jest.fn(async () => ({ id: "fr-1", status: "PENDING", amount: 100n, applicant: { wallet: "8gRg8wBPkT4ej3WPAVDc9nwKYoyypPFjHc2tUreCZM7t" } })),
      },
    });
    const { service } = makeService(prisma);
    const tx = "sig".repeat(12);
    await service.approve("fr-1", "admin-1", { txSignature: tx } as never);
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    const updateData = (prisma.financingRequest.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.status).toBe("APPROVED");
    expect(updateData.disbursedTxSignature).toBe(tx);
  });

  it("approve：非 PENDING 拒绝", async () => {
    const prisma = makePrisma({
      financingRequest: {
        findUnique: jest.fn(async () => ({ id: "fr-1", status: "APPROVED", amount: 100n, applicant: { wallet: "8gRg8wBPkT4ej3WPAVDc9nwKYoyypPFjHc2tUreCZM7t" } })),
      },
    });
    const { service } = makeService(prisma);
    await expect(service.approve("fr-1", "admin-1", { txSignature: "sig".repeat(12) } as never)).rejects.toThrow(BadRequestException);
  });

  it("apply：拒绝他人发票", async () => {
    const prisma = makePrisma({
      file: { findUnique: jest.fn(async () => ({ id: "f1", uploaderId: "other", status: "APPROVED", hash: "h", filename: "a.pdf" })) },
    });
    const { service } = makeService(prisma);
    await expect(
      service.apply("u1", { invoiceId: "f1", invoiceAmount: "1000000", amount: "500000", tenorDays: 30, turnstileToken: "t" }),
    ).rejects.toThrow(ForbiddenException);
  });
});
