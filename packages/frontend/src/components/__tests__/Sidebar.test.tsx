import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

const { pathnameMock, searchParamsMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(),
  searchParamsMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    pathnameMock.mockReturnValue("/dashboard");
    searchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it("renders admin menu items for ADMIN role", () => {
    render(<Sidebar role="ADMIN" />);
    expect(screen.getByText("上传文件")).toBeTruthy();
    expect(screen.getByText("文件审核")).toBeTruthy();
    expect(screen.getByText("审计日志")).toBeTruthy();
    expect(screen.getByText("全部订单")).toBeTruthy();
    expect(screen.getByText("供应链管理")).toBeTruthy();
    expect(screen.getByText("提款管理")).toBeTruthy();
    expect(screen.getByText("全部文件")).toBeTruthy();
    // 安全设置与账号信息已移至头像下拉框，不再出现在侧边栏
    expect(screen.queryByText("安全设置")).toBeNull();
    expect(screen.queryByText("管理账号信息")).toBeNull();
  });

  it("renders user menu items for USER role", () => {
    render(<Sidebar role="USER" />);
    expect(screen.getByText("上传文件")).toBeTruthy();
    expect(screen.getByText("我的文件")).toBeTruthy();
    expect(screen.getByText("我的订单")).toBeTruthy();
    expect(screen.queryByText("审计日志")).toBeNull();
    expect(screen.queryByText("管理账号信息")).toBeNull();
    expect(screen.queryByText("安全设置")).toBeNull();
  });

  it("highlights the active route", () => {
    pathnameMock.mockReturnValue("/user/upload");
    const { container } = render(<Sidebar role="USER" />);
    const activeLink = container.querySelector('a[href="/user/upload"]');
    expect(activeLink?.className).toContain("border-[#00E676]");
  });

  it("highlights only 文件审核 (status=PENDING) when on PENDING view", () => {
    pathnameMock.mockReturnValue("/admin/files");
    searchParamsMock.mockReturnValue(new URLSearchParams("status=PENDING"));
    const { container } = render(<Sidebar role="ADMIN" />);
    const review = container.querySelector('a[href="/admin/files?status=PENDING"]');
    const all = container.querySelector('a[href="/admin/files?status=ALL"]');
    expect(review?.className).toContain("border-[#00E676]");
    expect(all?.className).not.toContain("border-[#00E676]");
  });

  it("highlights only 全部文件 (status=ALL) when on ALL view", () => {
    pathnameMock.mockReturnValue("/admin/files");
    searchParamsMock.mockReturnValue(new URLSearchParams("status=ALL"));
    const { container } = render(<Sidebar role="ADMIN" />);
    const review = container.querySelector('a[href="/admin/files?status=PENDING"]');
    const all = container.querySelector('a[href="/admin/files?status=ALL"]');
    expect(review?.className).not.toContain("border-[#00E676]");
    expect(all?.className).toContain("border-[#00E676]");
  });

  it("switches highlight on query-only navigation between file menus (regression)", () => {
    pathnameMock.mockReturnValue("/admin/files");
    searchParamsMock.mockReturnValue(new URLSearchParams("status=PENDING"));
    const { container, rerender } = render(<Sidebar role="ADMIN" />);
    const review = container.querySelector('a[href="/admin/files?status=PENDING"]');
    const all = container.querySelector('a[href="/admin/files?status=ALL"]');
    expect(review?.className).toContain("border-[#00E676]");
    expect(all?.className).not.toContain("border-[#00E676]");

    // 模拟点击「全部文件」：pathname 不变，仅 search 变化（此前 usePathname 不会触发重渲染）
    searchParamsMock.mockReturnValue(new URLSearchParams("status=ALL"));
    rerender(<Sidebar role="ADMIN" />);
    expect(review?.className).not.toContain("border-[#00E676]");
    expect(all?.className).toContain("border-[#00E676]");
  });
});
