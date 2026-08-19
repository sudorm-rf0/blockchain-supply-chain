import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiAssistant } from "../AiAssistant";

const { chatMock, historyMock, sessionMock, deleteMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  historyMock: vi.fn(),
  sessionMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  aiChat: (...a: unknown[]) => chatMock(...a),
  fetchAiHistory: (...a: unknown[]) => historyMock(...a),
  fetchAiSession: (...a: unknown[]) => sessionMock(...a),
  deleteAiHistory: (...a: unknown[]) => deleteMock(...a),
}));

describe("AiAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockResolvedValue({ reply: "AI 回答", sessionId: "s1" });
    historyMock.mockResolvedValue([]);
  });

  it("点击悬浮按钮打开面板并显示欢迎语", async () => {
    render(<AiAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    expect(await screen.findByText(/平台 AI 助手/)).toBeTruthy();
    // 打开时拉取历史会话列表
    await waitFor(() => {
      expect(historyMock).toHaveBeenCalled();
    });
  });

  it("点快捷指令会直接发送给 AI 并展示回复", async () => {
    render(<AiAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    const cmd = await screen.findByRole("button", { name: "如何上传单据？" });
    fireEvent.click(cmd);
    await waitFor(() => {
      expect(chatMock).toHaveBeenCalledWith(
        "如何上传单据？",
        expect.any(Array),
        undefined,
        "zh-CN",
      );
    });
    expect(await screen.findByText("AI 回答")).toBeTruthy();
  });

  it("AI 请求失败时保留用户消息并可重试", async () => {
    chatMock.mockRejectedValueOnce(new Error("503 AI down"));
    render(<AiAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    const input = await screen.findByPlaceholderText("输入问题，Enter 发送");
    fireEvent.change(input, { target: { value: "测试消息XYZ789" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(chatMock).toHaveBeenCalled();
    });
    // 用户消息应保留（欢迎语消失）
    await waitFor(() => {
      expect(screen.queryByText(/平台 AI 助手/)).toBeNull();
    });
    expect(screen.getByText("测试消息XYZ789")).toBeTruthy();
  });
});
