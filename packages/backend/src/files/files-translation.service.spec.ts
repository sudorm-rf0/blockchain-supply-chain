import { FilesTranslationService } from "./files-translation.service";

function makePrisma() {
  return {
    file: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as never;
}

function makeAudit() {
  return { record: jest.fn() } as never;
}

function makeLlm() {
  return { complete: jest.fn() } as never;
}

describe("FilesTranslationService", () => {
  const prisma = makePrisma() as {
    file: { findUnique: jest.Mock; update: jest.Mock };
  };
  const audit = makeAudit() as { record: jest.Mock };
  const llm = makeLlm() as { complete: jest.Mock };

  beforeEach(() => jest.clearAllMocks());

  it("uses AI to clean OCR garbled text and translate", async () => {
    llm.complete.mockResolvedValue("The goods were shipped on 2025-08-03.");
    prisma.file.findUnique.mockResolvedValue({
      id: "f1",
      ocrText: "这是中文测试文本。",
      translations: null,
    });
    prisma.file.update.mockResolvedValue({});
    const svc = new FilesTranslationService(prisma as never, audit as never, llm as never);
    const out = await svc.translate("f1", "en", "user-1");
    expect(out.targetLang).toBe("en");
    // 校验 LLM prompt 包含 OCR 乱码清洗要求
    const systemPrompt = llm.complete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("OCR");
    expect(systemPrompt).toContain("修正");
    expect(systemPrompt).toContain("正式、专业、书面");
    expect(out.text).toContain("goods");
    expect(prisma.file.update).toHaveBeenCalled();
  });

  it("rejects when file has no OCR text", async () => {
    prisma.file.findUnique.mockResolvedValue({ id: "f1", ocrText: null, translations: null });
    const svc = new FilesTranslationService(prisma as never, audit as never, llm as never);
    await expect(svc.translate("f1", "en", "u")).rejects.toThrow("未识别出文字");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("falls back to free API when AI fails", async () => {
    llm.complete.mockRejectedValue(new Error("AI down"));
    prisma.file.findUnique.mockResolvedValue({
      id: "f1",
      ocrText: "这是测试文本。",
      translations: null,
    });
    prisma.file.update.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: "This is test text." },
      }),
    }) as never;
    const svc = new FilesTranslationService(prisma as never, audit as never, llm as never);
    const out = await svc.translate("f1", "en", "u");
    expect(out.text).toContain("test text");
  });

  it("detects source language from CJK ratio", () => {
    const svc = new FilesTranslationService(prisma as never, audit as never, llm as never);
    // @ts-expect-error access private method for unit test
    expect(svc.detectSourceLang("这是中文内容，用于测试翻译。")).toBe("zh-CN");
    // @ts-expect-error access private method for unit test
    expect(svc.detectSourceLang("This is English content for translation.")).toBe("en");
  });

  it("splits long text into chunks", () => {
    const svc = new FilesTranslationService(prisma as never, audit as never, llm as never);
    const long = Array.from({ length: 50 }, (_, i) => `line ${i} 测试内容`).join("\n");
    // @ts-expect-error access private method for unit test
    const chunks = svc.splitChunks(long, 80);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
