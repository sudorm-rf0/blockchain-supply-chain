import { Readable } from "node:stream";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AiLlmService } from "../ai/ai-llm.service";
import { FilesAiService } from "./files-ai.service";

// promisify(execFile) 依赖函数.length；jest.fn().length=0 会回调错位，故用 4 参命名函数委托。
let execFileMock: jest.Mock;
jest.mock("node:child_process", () => {
  const actual = jest.requireActual("node:child_process");
  function execFile(
    cmd: string,
    args: string[],
    opts: unknown,
    cb: (err: Error | null, result: unknown) => void,
  ) {
    return execFileMock(cmd, args, opts, cb);
  }
  return { ...actual, execFile };
});
const execFileAsMock = jest.fn();
execFileMock = execFileAsMock;

function makeStorage() {
  return {
    open: jest.fn(async () => Readable.from([Buffer.from("fake-pdf-bytes")])),
  };
}

function makePrisma(file: Record<string, unknown> | null) {
  return {
    file: {
      findUnique: jest.fn(async () => file),
    },
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

function makeLlm() {
  return {
    complete: jest.fn(async () => ""),
    modelName: "deepseek-v4-flash",
  };
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    path: "uploads/doc.pdf",
    filename: "test.pdf",
    mimeType: "application/pdf",
    status: "PENDING",
    description: null,
    remark: null,
    ocrText: "发票号 INV-001，金额 10000 元，买方 A，卖方 B",
    authScore: 90,
    authResult: null,
    uploaderId: "user-1",
    ...overrides,
  };
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => undefined),
  };
}

function makeService(
  prisma: ReturnType<typeof makePrisma>,
  llm: ReturnType<typeof makeLlm>,
  storage: ReturnType<typeof makeStorage> = makeStorage(),
) {
  const audit = makeAudit();
  const service = new FilesAiService(
    prisma as never,
    audit as never,
    llm as unknown as AiLlmService,
    storage as never,
    makeRedis() as never,
  );
  return { service, audit };
}

describe("FilesAiService", () => {
  beforeEach(() => execFileAsMock.mockReset());

  it("review 解析 AI 审核报告 JSON", async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValue(
      JSON.stringify({
        summary: "这是一份测试发票",
        riskLevel: "MEDIUM",
        riskAssessment: "金额较大需复核",
        suggestions: ["核对买方信息"],
        concerns: ["金额大写不一致"],
      }),
    );
    const { service, audit } = makeService(makePrisma(makeFile()), llm);
    const result = await service.review("f1", "user-1", "ADMIN");
    expect(result.summary).toBe("这是一份测试发票");
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.suggestions).toContain("核对买方信息");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "FILE_AI_REVIEWED" }),
    );
  });

  it("extract 返回结构化关键信息", async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValue(
      JSON.stringify({ invoiceNumber: "INV-001", amount: "10000 元", buyer: "A", seller: "B" }),
    );
    const { service } = makeService(makePrisma(makeFile()), llm);
    const result = await service.extract("f1", "user-1", "ADMIN");
    expect(result.fields.invoiceNumber).toBe("INV-001");
    expect(result.fields.amount).toBe("10000 元");
    expect(result.source).toBe("ocr");
  });

  it("summarize 返回自然语言摘要", async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValue("这是一份测试发票，金额一万元。");
    const { service } = makeService(makePrisma(makeFile()), llm);
    const result = await service.summarize("f1", "user-1", "ADMIN");
    expect(result.summary).toContain("测试发票");
  });

  it("chat 基于单据上下文回答", async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValue("发票金额一万元。");
    const { service } = makeService(makePrisma(makeFile()), llm);
    const result = await service.chat("f1", "user-1", "ADMIN", {
      message: "金额是多少？",
    });
    expect(result.reply).toContain("一万元");
    expect(llm.complete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "金额是多少？" }),
      ]),
      1000,
    );
  });

  it("PDF 无 OCR 结果时自动用 pdftotext 提取文本", async () => {
    execFileAsMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: unknown) => void) => {
        cb(null, { stdout: "这是从 PDF 文本层提取的内容 2026", stderr: "" });
      },
    );
    const llm = makeLlm();
    llm.complete.mockResolvedValue("ok");
    const { service } = makeService(
      makePrisma(makeFile({ ocrText: null })),
      llm,
    );
    await service.summarize("f1", "user-1", "ADMIN");
    // 摘要请求应包含自动提取的 PDF 文本
    const completeMock = llm.complete as jest.Mock;
    const messages = completeMock.mock.calls[0]?.[0] as
      | Array<{ role: string; content: string }>
      | undefined;
    expect(messages?.some((m) => m.content.includes("自动提取 PDF 文本"))).toBe(true);
    expect(execFileAsMock).toHaveBeenCalledWith(
      "pdftotext",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("非管理员且非上传者无权访问 AI 功能", async () => {
    const llm = makeLlm();
    const { service } = makeService(makePrisma(makeFile({ uploaderId: "owner-1" })), llm);
    await expect(service.review("f1", "user-1", "USER")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("文件不存在时 AI 功能抛出 NotFound", async () => {
    const llm = makeLlm();
    const { service } = makeService(makePrisma(null), llm);
    await expect(service.review("missing", "user-1", "ADMIN")).rejects.toThrow(
      NotFoundException,
    );
  });
});
