import { PublicVerifyController } from "./public-verify.controller";
import { PrismaService } from "../prisma/prisma.service";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    file: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    tradeDeal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    ...overrides,
  } as unknown as PrismaService;
}

const fileRow = {
  id: "f1",
  filename: "发票.pdf",
  hash: "a".repeat(64),
  status: "APPROVED",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  analyzedAt: new Date("2026-08-01T00:01:00Z"),
  authScore: 92,
  attestedAt: new Date("2026-08-01T00:02:00Z"),
  txSignature: "4xZQvQaYp3DbY6Xr9wLkQ2sT1uVzMnpH8gF7cD5bA1eR0tYxUvWzQpLkM4n",
  documentPda: "DocPda123",
  uploader: { name: "Alice" },
};

describe("PublicVerifyController", () => {
  const prisma = makePrisma();
  const controller = new PublicVerifyController(prisma);

  beforeEach(() => jest.clearAllMocks());

  describe("verify", () => {
    it("returns file by sha256 hash", async () => {
      (prisma.file.findFirst as jest.Mock).mockResolvedValue(fileRow);
      const out = await controller.verify("a".repeat(64));
      expect(out.ok).toBe(true);
      expect(out.file!.filename).toBe("发票.pdf");
      // 隐私修复：公开接口不得披露上传者姓名/对象。
      expect("uploaderName" in out.file!).toBe(false);
      expect("uploader" in out.file!).toBe(false);
      expect(out.file!.solscanUrl).toMatch(/^https:\/\/solscan\.io\/tx\//);
    });

    it("rejects invalid hash", async () => {
      const out = await controller.verify("zzz");
      expect(out.ok).toBe(false);
      expect(prisma.file.findFirst).not.toHaveBeenCalled();
    });

    it("returns file by id", async () => {
      (prisma.file.findUnique as jest.Mock).mockResolvedValue(fileRow);
      const out = await controller.verify(undefined, "f1");
      expect(out.ok).toBe(true);
      expect(prisma.file.findUnique).toHaveBeenCalledWith({
        where: { id: "f1" },
        select: expect.anything(),
      });
    });

    it("returns not found", async () => {
      (prisma.file.findUnique as jest.Mock).mockResolvedValue(null);
      const out = await controller.verify(undefined, "missing");
      expect(out).toEqual({ ok: false, error: "not found" });
    });
  });

  describe("trace", () => {
    it("builds file timeline: upload → analyze → attest", async () => {
      (prisma.file.findUnique as jest.Mock).mockResolvedValue(fileRow);
      (prisma.tradeDeal.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      const out = await controller.trace("f1");
      expect(out.ok).toBe(true);
      expect(out.asset!.type).toBe("FILE");
      expect(out.events!.map((e: { type: string }) => e.type)).toEqual([
        "ATTEST",
        "ANALYZE",
        "UPLOAD",
      ]);
      expect(out.events![0].solscanUrl).toContain("solscan.io");
    });

    it("builds trade timeline", async () => {
      (prisma.file.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.tradeDeal.findUnique as jest.Mock).mockResolvedValue({
        id: "t1",
        dealId: "D-001",
        status: "ACTIVE",
        amount: 1000000n,
        buyerWallet: "Wallet11111111111111111111111111111111",
        sellerWallet: "Wallet22222222222222222222222222222222",
        createdAt: new Date("2026-08-02T00:00:00Z"),
        repaidAt: null,
        txSignature: "txSig123",
      });
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      const out = await controller.trace("t1");
      expect(out.ok).toBe(true);
      expect(out.asset!.type).toBe("TRADE");
      expect(out.events!).toHaveLength(2);
    });

    it("returns not found for unknown id", async () => {
      (prisma.file.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.tradeDeal.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      const out = await controller.trace("nope");
      expect(out).toEqual({ ok: false, error: "not found" });
    });
  });

  describe("activity", () => {
    it("merges file/deal/product events sorted desc", async () => {
      (prisma.file.findMany as jest.Mock).mockResolvedValue([
        { ...fileRow, filename: "a.pdf", attestedAt: new Date("2026-08-05T00:00:00Z") },
      ]);
      (prisma.tradeDeal.findMany as jest.Mock).mockResolvedValue([
        { id: "t1", dealId: "D-1", createdAt: new Date("2026-08-06T00:00:00Z"), txSignature: "tx1" },
      ]);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { id: "p1", sku: "SKU1", createdAt: new Date("2026-08-04T00:00:00Z"), txSignature: "tx2" },
      ]);
      const out = await controller.activity("10");
      expect(out.ok).toBe(true);
      expect(out.items!).toHaveLength(3);
      expect(out.items![0].type).toBe("TRADE");
      expect(out.items![2].type).toBe("PRODUCT");
      expect(out.items![0].solscanUrl).toBeDefined();
    });

    it("caps limit at 50", async () => {
      (prisma.file.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.tradeDeal.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      await controller.activity("9999");
      // take 被限制为 50
      expect(prisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });
});
