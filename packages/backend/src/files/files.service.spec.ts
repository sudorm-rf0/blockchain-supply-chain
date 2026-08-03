import {
  ConflictException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesService } from "./files.service";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function makePrisma() {
  return {
    file: {
      create: jest.fn(async ({ data }) => ({
        id: "f1",
        createdAt: new Date(),
        ...data,
      })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ data }) => ({ id: "f1", ...data })),
      delete: jest.fn(async () => ({ ok: true })),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: "user-1",
        wallet: "buyerWallet",
      })),
    },
    tradeDeal: {
      findUnique: jest.fn(async () => ({
        buyerWallet: "buyerWallet",
        sellerWallet: "sellerWallet",
      })),
    },
  };
}

function makeStorage() {
  return {
    persist: jest.fn(async (_localPath: string, originalName: string) => ({
      storageKey: `/uploads/${originalName}`,
      size: 0,
    })),
    open: jest.fn(async () => ({ pipe: jest.fn() })),
    exists: jest.fn(async () => true),
    remove: jest.fn(async () => undefined),
  };
}

function makeAudit() {
  return {
    record: jest.fn(async () => undefined),
    list: jest.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 })),
  };
}

function makeRedisFiles() {
  return {
    get: jest.fn(async () => null),
    setEx: jest.fn(async () => undefined),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  };
}

function makeScan() {
  return { scan: jest.fn(async () => ({ clean: true })) };
}

describe("FilesService", () => {
  const dir = mkdtempSync(join(tmpdir(), "files-spec-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects a file whose magic bytes do not match the extension", async () => {
    const service = new FilesService(
      makePrisma() as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const path = join(dir, "fake.png");
    writeFileSync(path, "this is not an image");
    const file = {
      originalname: "fake.png",
      path,
      size: 20,
      mimetype: "image/png",
    } as Express.Multer.File;
    await expect(
      service.upload(file, {}, "user-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("accepts a valid PNG and persists its sha256", async () => {
    const prisma = makePrisma();
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const path = join(dir, "ok.png");
    writeFileSync(path, PNG_BYTES);
    const file = {
      originalname: "ok.png",
      path,
      size: PNG_BYTES.length,
      mimetype: "image/png",
    } as Express.Multer.File;
    const result = await service.upload(file, { tradeId: "42" }, "user-1");
    expect(result.id).toBe("f1");
    expect(prisma.tradeDeal.findUnique).toHaveBeenCalledWith({
      where: { dealId: "42" },
      select: { buyerWallet: true, sellerWallet: true },
    });
    expect(prisma.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          tradeId: "42",
          uploaderId: "user-1",
        }),
      }),
    );
  });

  it("creates the next version and supersedes older files in the same document", async () => {
    const prisma = makePrisma();
    (prisma.file.findFirst as jest.Mock).mockImplementation(
      async ({ where }: { where: { documentGroupId?: string } }) =>
        where.documentGroupId ? { version: 2 } : null,
    );
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const path = join(dir, "version.png");
    writeFileSync(path, PNG_BYTES);
    const file = {
      originalname: "version.png",
      path,
      size: PNG_BYTES.length,
      mimetype: "image/png",
    } as Express.Multer.File;
    const result = await service.upload(
      file,
      { tradeId: "42", documentId: "export-invoice" },
      "user-1",
    );
    expect(result.version).toBe(3);
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: {
        documentGroupId: "export-invoice",
        uploaderId: "user-1",
        supersededAt: null,
      },
      data: { supersededAt: expect.any(Date) },
    });
    expect(prisma.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentGroupId: "export-invoice",
          version: 3,
        }),
      }),
    );
  });

  it("rejects uploads tied to a trade the user is not a party to", async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      wallet: "attackerWallet",
    });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const path = join(dir, "owned.png");
    writeFileSync(path, PNG_BYTES);
    const file = {
      originalname: "owned.png",
      path,
      size: PNG_BYTES.length,
      mimetype: "image/png",
    } as Express.Multer.File;
    await expect(
      service.upload(file, { tradeId: "42" }, "user-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects duplicate uploads of the same hash by the same user", async () => {
    const prisma = makePrisma();
    (prisma.file.findFirst as jest.Mock).mockResolvedValue({ id: "existing" });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const path = join(dir, "dup.png");
    writeFileSync(path, PNG_BYTES);
    const file = {
      originalname: "dup.png",
      path,
      size: PNG_BYTES.length,
      mimetype: "image/png",
    } as Express.Multer.File;
    await expect(
      service.upload(file, {}, "user-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects uploads beyond the daily quota", async () => {
    const redis = makeRedisFiles();
    (redis.get as jest.Mock).mockResolvedValue("200");
    const service = new FilesService(
      makePrisma() as never,
      makeStorage() as never,
      makeAudit() as never,
      redis as never,
      makeScan() as never,
    );
    const path = join(dir, "quota.png");
    writeFileSync(path, PNG_BYTES);
    const file = {
      originalname: "quota.png",
      path,
      size: PNG_BYTES.length,
      mimetype: "image/png",
    } as Express.Multer.File;
    await expect(
      service.upload(file, {}, "user-1"),
    ).rejects.toThrow(HttpException);
  });

  it("blocks non-owners from viewing file versions", async () => {
    const prisma = makePrisma();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: "f1",
      uploaderId: "owner-1",
    });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    await expect(service.getVersions("f1", "user-1", "USER")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("returns a single-item version list when the file has no document group", async () => {
    const prisma = makePrisma();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: "f1",
      uploaderId: "user-1",
      documentGroupId: null,
      supersededAt: null,
      createdAt: new Date(),
    });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    const result = await service.getVersions("f1", "user-1", "USER");
    expect(result).toHaveLength(1);
  });

  it("scopes version history to the owner for non-admin users", async () => {
    const prisma = makePrisma();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: "f1",
      uploaderId: "user-1",
      documentGroupId: "group-1",
      supersededAt: null,
      createdAt: new Date(),
    });
    (prisma.file.findMany as jest.Mock).mockResolvedValue([]);
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    await service.getVersions("f1", "user-1", "USER");
    expect(prisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uploaderId: "user-1" }),
      }),
    );
  });

  it("rejects deleting an attested file", async () => {
    const prisma = makePrisma();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: "f1",
      uploaderId: "user-1",
      txSignature: "sig",
      path: "/uploads/f1.png",
    });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    await expect(
      service.remove("f1", "user-1", "USER", "true"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks non-owners from deleting files", async () => {
    const prisma = makePrisma();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: "f1",
      uploaderId: "owner-1",
      txSignature: null,
      path: "/uploads/f1.png",
    });
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    await expect(
      service.remove("f1", "user-1", "USER", "true"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("scopes file lists to the requesting user", async () => {
    const prisma = makePrisma();
    (prisma.file.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.file.count as jest.Mock).mockResolvedValue(0);
    const service = new FilesService(
      prisma as never,
      makeStorage() as never,
      makeAudit() as never,
      makeRedisFiles() as never,
      makeScan() as never,
    );
    await service.list({ page: 1, limit: 10, userId: "user-1" });
    expect(prisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uploaderId: "user-1" }),
      }),
    );
  });
});
