import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccountPage from "../page";
import type { AuthUser } from "@/lib/types";

const { fetchSessionMock, submitFeedbackMock, changeNameMock, toastSuccess, toastError, replaceMock } =
  vi.hoisted(() => ({
    fetchSessionMock: vi.fn(),
    submitFeedbackMock: vi.fn(),
    changeNameMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    replaceMock: vi.fn(),
  }));

const user: AuthUser = {
  id: "u1",
  email: "user@example.com",
  name: "测试用户",
  role: "USER",
  wallet: "",
  mustChangePassword: false,
  emailOtpEnabled: true,
  totpEnabled: false,
};

vi.mock("@/lib/api", () => ({
  fetchSession: (...a: unknown[]) => fetchSessionMock(...a),
  submitFeedback: (...a: unknown[]) => submitFeedbackMock(...a),
  changeName: (...a: unknown[]) => changeNameMock(...a),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  logout: vi.fn(),
  sendEmailCode: vi.fn(),
  sendEmailOtpCode: vi.fn(async () => ({ expiresIn: 300, cooldownSeconds: 60 })),
}));

vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({ user, setAuth: vi.fn(), hydrated: true, setHydrated: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/components/Turnstile", () => ({
  default: () => <div data-testid="turnstile" />,
}));

vi.mock("@/components/SpamWarningDialog", () => ({
  SpamWarningDialog: () => <div />,
  shouldShowSpamHint: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock("@/lib/env", () => ({
  TURNSTILE_SITE_KEY: "",
}));

async function renderPage() {
  fetchSessionMock.mockResolvedValue(user);
  await act(async () => {
    render(<AccountPage />);
  });
}

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitFeedbackMock.mockResolvedValue({ ok: true });
  });

  it("渲染各设置模块与意见反馈卡片", async () => {
    await renderPage();
    expect(await screen.findByText("修改名称")).toBeTruthy();
    expect(screen.getByText("修改邮箱")).toBeTruthy();
    expect(screen.getByText("修改密码")).toBeTruthy();
    expect(screen.getByText("意见反馈")).toBeTruthy();
  });

  it("提交意见反馈会调用 API", async () => {
    await renderPage();
    await screen.findByText("意见反馈");
    const textarea = screen.getByLabelText("反馈内容");
    fireEvent.change(textarea, { target: { value: "希望增加批量审核" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
    await waitFor(() => {
      expect(submitFeedbackMock).toHaveBeenCalledWith({
        content: "希望增加批量审核",
        contact: undefined,
      });
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("未输入验证码时改名被拦截", async () => {
    await renderPage();
    await screen.findByText("修改名称");
    fireEvent.change(screen.getByLabelText("新名称"), { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改名称" }));
    await waitFor(() => {
      expect(changeNameMock).not.toHaveBeenCalled();
    });
    expect(toastError).toHaveBeenCalled();
  });
});
