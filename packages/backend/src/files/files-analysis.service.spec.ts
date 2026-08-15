import { Readable } from "node:stream";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { FilesAnalysisService } from "./files-analysis.service";

// 注意：服务内部用 promisify(execFile)，promisify 依赖函数.length 定位回调位置，
// jest.fn().length === 0 会导致回调错位；因此 mock 工厂返回带 4 个形参的命名函数，
// 运行时委托给 execFileMock（在测试体内晚初始化，函数体内引用是惰性的）。
let execFileMock: jest.Mock;
jest.mock("node:child_process", () => {
  const actual = jest.requireActual("node:child_process");
  function execFile(
    cmd: string,
    args: string[],
    opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) {
    return execFileMock(cmd, args, opts, cb);
  }
  return { ...actual, execFile };
});

const execFileAsMock = jest.fn();

function makeStorage() {
  return {
    open: jest.fn(async () => Readable.from([Buffer.from("fake-pdf-bytes")])),
  };
}

function makePrisma(file: Record<string, unknown> | null) {
  return {
    file: {
      findUnique: jest.fn(async () => file),
      update: jest.fn(async ({ data }) => ({ id: "f1", ...data })),
    },
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    path: "uploads/doc.pdf",
    filename: "test.pdf",
    mimeType: "application/pdf",
    hash: "abc",
    uploaderId: "user-1",
    attestedAt: null,
    txSignature: null,
    ocrStatus: "PENDING",
    authStatus: "PENDING",
    ...overrides,
  };
}

/** 模拟 execFile 回调风格（promisify(execFile)）：promisify 会 resolve 回调的第一个值 */
function mockExec(results: Record<string, string>) {
  execFileAsMock.mockImplementation(
    (cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: unknown) => void) => {
      cb(null, { stdout: results[cmd] ?? "", stderr: "" });
    },
  );
}

describe("FilesAnalysisService PDF 适配", () => {
  execFileMock = execFileAsMock;

beforeEach(() => execFileAsMock.mockReset());

  it("优先使用 pdftotext 提取 PDF 文本层（有文本时不再跑 tesseract OCR）", async () => {
    mockExec({ pdftotext: "这是一份测试发票，金额 10000 元，日期 2026-08-01。" });
    const prisma = makePrisma(makeFile());
    const service = new FilesAnalysisService(
      prisma as never,
      makeAudit() as never,
      makeStorage() as never,
    );
    const result = await service.analyze("f1", "user-1", "ADMIN");
    expect(result.ocrSource).toBe("pdftotext");
    expect(result.ocrText).toContain("测试发票");
    // 不再调用 pdftoppm / tesseract（节省资源、更准确）
    expect(execFileAsMock).not.toHaveBeenCalledWith(
      "pdftoppm",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(execFileAsMock).not.toHaveBeenCalledWith(
      "tesseract",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("PDF 无文本层（扫描件）时回退到 tesseract OCR", async () => {
    mockExec({ pdftotext: "", pdftoppm: "", tesseract: "扫描件识别文本 123456" });
    const prisma = makePrisma(makeFile());
    const service = new FilesAnalysisService(
      prisma as never,
      makeAudit() as never,
      makeStorage() as never,
    );
    const result = await service.analyze("f1", "user-1", "ADMIN");
    // pdftoppm 被调用 → 证明走了图像 OCR 回退路径
    expect(execFileAsMock).toHaveBeenCalledWith(
      "pdftoppm",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.ocrSource).toBe("none"); // 无图片生成时无 OCR 文本
  });

  it("非管理员且非上传者无权分析", async () => {
    mockExec({ pdftotext: "x" });
    const prisma = makePrisma(makeFile({ uploaderId: "owner-1" }));
    const service = new FilesAnalysisService(
      prisma as never,
      makeAudit() as never,
      makeStorage() as never,
    );
    await expect(service.analyze("f1", "user-1", "USER")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("文件不存在时抛出 NotFound", async () => {
    mockExec({ pdftotext: "x" });
    const service = new FilesAnalysisService(
      makePrisma(null) as never,
      makeAudit() as never,
      makeStorage() as never,
    );
    await expect(service.analyze("missing", "user-1", "ADMIN")).rejects.toThrow(
      NotFoundException,
    );
  });
});
