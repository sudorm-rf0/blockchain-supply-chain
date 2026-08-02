import { ForbiddenException } from "@nestjs/common";
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
      create: jest.fn(async ({ data }) => ({ id: "f1", ...data })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async ({ data }) => ({ id: "f1", ...data })),
      delete: jest.fn(async () => ({ ok: true })),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
  };
}

describe("FilesService", () => {
  const dir = mkdtempSync(join(tmpdir(), "files-spec-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects a file whose magic bytes do not match the extension", async () => {
    const service = new FilesService(makePrisma() as never);
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
    const service = new FilesService(prisma as never);
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
});
