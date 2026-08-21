import { ServiceUnavailableException } from "@nestjs/common";
import { sanitizeAiText, AiLlmService } from "./ai-llm.service";

describe("sanitizeAiText", () => {
  it("删除星号（含 ** 加粗）、破折号、省略号与表格符号", () => {
    const input =
      "**一、基本信息**\n| 项目 | 内容 |\n|------|------|\n金额 10000 元… 日期 2025-08-03 - 单号 LLYW-2508007";
    const out = sanitizeAiText(input);
    expect(out).not.toContain("*");
    expect(out).not.toContain("|");
    expect(out).not.toContain("…");
    expect(out).not.toContain("---");
  });

  it("保留数字/单号内部的连字符（日期与单号不被破坏）", () => {
    const out = sanitizeAiText("开票日期 2025-08-03，发票号 LLYW-2508007");
    expect(out).toContain("2025-08-03");
    expect(out).toContain("LLYW-2508007");
  });

  it("清理行首 bullet 与多余空行", () => {
    const out = sanitizeAiText("- 第一条\n- 第二条\n\n\n结尾");
    expect(out).not.toContain("- 第一条");
    expect(out).toContain("第一条");
    expect(out).not.toContain("\n\n\n");
  });
});

describe("AiLlmService.complete 多节点 fallback", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL =
      "https://node-a.example.com/v1, https://node-b.example.com/v1";
    process.env.AI_MODEL = "test-model";
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("主节点失败自动切换备用节点", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: " 备用节点回复  " } }] }),
          { status: 200 },
        ),
      );
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const svc = new AiLlmService();
    const result = await svc.complete([{ role: "user", content: "hi" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toBe("备用节点回复");
  });

  it("所有节点失败抛 503", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError("fetch failed"));
    const svc = new AiLlmService();
    await expect(svc.complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("401 鉴权失败直接抛出，不尝试备用节点", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad key" }), { status: 401 }),
    );
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const svc = new AiLlmService();
    await expect(svc.complete([{ role: "user", content: "hi" }])).rejects.toThrow("鉴权失败");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
