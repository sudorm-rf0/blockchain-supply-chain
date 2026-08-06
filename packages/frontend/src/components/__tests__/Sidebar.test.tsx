import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    pathnameMock.mockReturnValue("/dashboard");
  });

  it("renders admin menu items for ADMIN role", () => {
    render(<Sidebar role="ADMIN" />);
    expect(screen.getByText("文件审核")).toBeTruthy();
    expect(screen.getByText("审计日志")).toBeTruthy();
    expect(screen.getByText("全部订单")).toBeTruthy();
    expect(screen.getByText("供应链管理")).toBeTruthy();
    expect(screen.getByText("安全设置")).toBeTruthy();
    expect(screen.getByText("提款管理")).toBeTruthy();
    expect(screen.getByText("全部文件")).toBeTruthy();
  });

  it("renders user menu items for USER role", () => {
    render(<Sidebar role="USER" />);
    expect(screen.getByText("上传文件")).toBeTruthy();
    expect(screen.getByText("我的文件")).toBeTruthy();
    expect(screen.getByText("我的订单")).toBeTruthy();
    expect(screen.queryByText("审计日志")).toBeNull();
  });

  it("highlights the active route", () => {
    pathnameMock.mockReturnValue("/user/upload");
    const { container } = render(<Sidebar role="USER" />);
    const activeLink = container.querySelector('a[href="/user/upload"]');
    expect(activeLink?.className).toContain("bg-slate-700");
  });
});
