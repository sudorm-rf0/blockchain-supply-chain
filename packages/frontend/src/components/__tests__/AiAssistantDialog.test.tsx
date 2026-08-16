import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiAssistantDialog } from "../AiAssistantDialog";
import type { FileRecord } from "@/lib/types";

const { reviewMock, extractMock, summarizeMock, chatMock } = vi.hoisted(() => ({
  reviewMock: vi.fn(),
  extractMock: vi.fn(),
  summarizeMock: vi.fn(),
  chatMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  aiReviewFile: (...a: unknown[]) => reviewMock(...a),
  aiExtractFile: (...a: unknown[]) => extractMock(...a),
  aiSummarizeFile: (...a: unknown[]) => summarizeMock(...a),
  aiChatFile: (...a: unknown[]) => chatMock(...a),
}));

const file = {
  id: "f1",
  filename: "test.pdf",
} as unknown as FileRecord;

async function renderDialog() {
  await act(async () => {
    render(
      <AiAssistantDialog file={file} open onOpenChange={() => {}} />,
    );
  });
}

describe("AiAssistantDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewMock.mockResolvedValue({
      summary: "这是一份测试单据",
      riskLevel: "LOW",
      riskAssessment: "",
      suggestions: [],
      concerns: [],
    });
    extractMock.mockResolvedValue({ fields: { invoiceNumber: "INV-001" }, source: "ocr" });
    summarizeMock.mockResolvedValue({ summary: "单据摘要内容" });
    chatMock.mockResolvedValue({ reply: "AI 回复" });
  });

  it("打开时自动生成 AI 审核报告", async () => {
    await renderDialog();
    await waitFor(() => {
      expect(reviewMock).toHaveBeenCalledWith("f1");
    });
    expect(await screen.findByText("这是一份测试单据")).toBeTruthy();
  });

  it("关键信息标签页触发提取并展示字段", async () => {
    await renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /关键信息/ }));
    await waitFor(() => {
      expect(extractMock).toHaveBeenCalledWith("f1");
    });
    expect(await screen.findByText("INV-001")).toBeTruthy();
  });

  it("摘要标签页触发摘要并展示文本", async () => {
    await renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /摘要/ }));
    await waitFor(() => {
      expect(summarizeMock).toHaveBeenCalledWith("f1");
    });
    expect(await screen.findByText("单据摘要内容")).toBeTruthy();
  });

  it("对话标签页发送问题并展示回复", async () => {
    await renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /对话/ }));
    const input = await screen.findByPlaceholderText(/输入问题/);
    fireEvent.change(input, { target: { value: "金额是多少？" } });
    // Enter 发送
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(chatMock).toHaveBeenCalledWith(
        "f1",
        expect.objectContaining({ message: "金额是多少？" }),
      );
    });
    expect(await screen.findByText("AI 回复")).toBeTruthy();
  });
});
