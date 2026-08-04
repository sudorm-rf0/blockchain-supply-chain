import { BadRequestException } from "@nestjs/common";
import { SupplyChainService } from "./supply-chain.service";
import { deriveRegistryPda, getProgramId } from "./solana/tx-builder";

const mockAccountInfo = jest.fn();

jest.mock("./solana/tx-builder", () => {
  const actual = jest.requireActual("./solana/tx-builder");
  return {
    ...actual,
    getConnection: jest.fn(() => ({
      getAccountInfo: mockAccountInfo,
      getLatestBlockhash: jest.fn(async () => ({
        blockhash: "3xKQ8gLxT5qQwR2vX8Jf9QmCzNp1VbYdAaBbCcDdEeFf",
      })),
      getTransaction: jest.fn(async () => null),
    })),
  };
});

describe("SupplyChainService", () => {
  const prisma = {} as never;
  const audit = {} as never;
  const service = new SupplyChainService(prisma, audit);

  beforeEach(() => {
    mockAccountInfo.mockReset();
  });

  it("reports an uninitialized registry", async () => {
    mockAccountInfo.mockResolvedValue(null);
    const status = await service.registryStatus();
    expect(status.initialized).toBe(false);
    expect(status.registry).toBe(
      deriveRegistryPda(getProgramId()).toBase58(),
    );
    expect(status.admin).toBeNull();
  });

  it("builds an initialize_registry transaction for the admin wallet", async () => {
    mockAccountInfo.mockResolvedValue(null);
    const built = await service.buildInitRegistry(
      "3SDgHKjYxABmtJKYeoy6ssokyXf18dY39Z9VzDLChWRH",
    );
    expect(built.transaction.length).toBeGreaterThan(0);
    expect(built.registry).toBe(deriveRegistryPda(getProgramId()).toBase58());
  });

  it("rejects an empty SKU when registering a product", async () => {
    await expect(
      service.buildRegisterProduct(
        "3SDgHKjYxABmtJKYeoy6ssokyXf18dY39Z9VzDLChWRH",
        "",
        "10",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects non-positive units when registering a product", async () => {
    await expect(
      service.buildRegisterProduct(
        "3SDgHKjYxABmtJKYeoy6ssokyXf18dY39Z9VzDLChWRH",
        "SKU-1",
        "0",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an invalid admin wallet", async () => {
    await expect(service.buildInitRegistry("not-a-pubkey")).rejects.toThrow(
      BadRequestException,
    );
  });
});
