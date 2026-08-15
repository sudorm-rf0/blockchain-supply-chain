import { sanitizeAiText } from "./ai-llm.service";

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
