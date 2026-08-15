"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Boxes, ClipboardCheck, Banknote, Files, LayoutDashboard, ReceiptText, ScrollText, Settings2, ShieldCheck, Ticket, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface SidebarProps {
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
  /** 点击菜单项后的回调（移动端用于关闭抽屉） */
  onNavigate?: () => void;
}

export function Sidebar({ role, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const items =
    isAdmin
      ? [
          ...(role === "SUPER_ADMIN"
            ? [
                { href: "/admin/accounts", label: t("sidebar.accounts"), icon: ShieldCheck },
                { href: "/admin/invite-codes", label: t("sidebar.inviteStats"), icon: Ticket },
                { href: "/admin/settings", label: t("sidebar.systemSettings"), icon: Settings2 },
              ]
            : []),
          {
            href: "/user/upload",
            label: t("sidebar.uploadFile"),
            icon: Upload,
          },
          {
            href: "/admin/files?status=PENDING",
            label: t("sidebar.fileReview"),
            icon: ClipboardCheck,
          },
          { href: "/admin/audit", label: t("sidebar.auditLog"), icon: ScrollText },
          { href: "/admin/trades", label: t("sidebar.allOrders"), icon: ReceiptText },
          { href: "/admin/supply-chain", label: t("sidebar.supplyChain"), icon: Boxes },
          { href: "/admin/withdrawals", label: t("sidebar.withdrawals"), icon: Banknote },
          { href: "/admin/financing", label: t("sidebar.financingReview"), icon: Banknote },
          { href: "/orders", label: t("sidebar.myOrders"), icon: ReceiptText },
          {
            href: "/admin/files?status=ALL",
            label: t("sidebar.allFiles"),
            icon: Files,
          },
        ]
      : [
          { href: "/user/upload", label: t("sidebar.uploadFile"), icon: Upload },
          { href: "/user/files", label: t("sidebar.myFiles"), icon: Files },
          { href: "/orders", label: t("sidebar.myOrders"), icon: ReceiptText },
          { href: "/financing", label: t("sidebar.financing"), icon: Banknote },
        ];

  const isActive = (href: string) => {
    const [base, query] = href.split("?");
    const pathMatch = pathname === base || pathname.startsWith(`${base}/`);
    if (!pathMatch) return false;
    if (!query) return true;
    // 带 query 的菜单项（如 /admin/files?status=…）需精确匹配 status，
    // 避免「文件审核」与「全部文件」因 path 相同而同时高亮。
    const want = new URLSearchParams(query).get("status");
    const have = searchParams.get("status");
    return want === have;
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-background">
      <div className="border-b border-border px-5 py-4 font-mono text-sm font-semibold tracking-widest text-foreground">
        DFR SUPPLY CHAIN
      </div>
      <nav className="flex-1 space-y-px p-2">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 border-l-2 px-3 py-2 font-mono text-[13px] transition-all duration-200",
            pathname === "/dashboard"
              ? "border-[#00E676] bg-primary/10 text-[#00E676] shadow-[inset_0_0_16px_-8px_rgba(0,230,118,0.5)]"
              : "border-transparent text-muted-foreground hover:translate-x-0.5 hover:bg-muted hover:text-foreground",
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          {t("sidebar.dashboard")}
        </Link>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 border-l-2 px-3 py-2 font-mono text-[13px] transition-all duration-200",
                active
                  ? "border-[#00E676] bg-primary/10 text-[#00E676] shadow-[inset_0_0_16px_-8px_rgba(0,230,118,0.5)]"
                  : "border-transparent text-muted-foreground hover:translate-x-0.5 hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
