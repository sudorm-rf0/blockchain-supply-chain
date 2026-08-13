"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardCheck,
  Banknote,
  Files,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const items =
    isAdmin
      ? [
          ...(role === "SUPER_ADMIN"
            ? [{ href: "/admin/accounts", label: "账号管理", icon: ShieldCheck }]
            : []),
          {
            href: "/admin/files?status=PENDING",
            label: "文件审核",
            icon: ClipboardCheck,
          },
          { href: "/admin/audit", label: "审计日志", icon: ScrollText },
          { href: "/admin/trades", label: "全部订单", icon: ReceiptText },
          { href: "/admin/supply-chain", label: "供应链管理", icon: Boxes },
          { href: "/admin/security", label: "安全设置", icon: ShieldCheck },
          { href: "/admin/withdrawals", label: "提款管理", icon: Banknote },
          { href: "/orders", label: "我的订单", icon: ReceiptText },
          {
            href: "/admin/files?status=ALL",
            label: "全部文件",
            icon: Files,
          },
        ]
      : [
          { href: "/user/upload", label: "上传文件", icon: Upload },
          { href: "/user/files", label: "我的文件", icon: Files },
          { href: "/orders", label: "我的订单", icon: ReceiptText },
        ];

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-background">
      <div className="border-b border-border px-5 py-4 font-mono text-sm font-semibold tracking-widest text-foreground">
        DFR SUPPLY CHAIN
      </div>
      <nav className="flex-1 space-y-px p-2">
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2 border-l-2 px-3 py-2 font-mono text-[13px] transition-colors",
            pathname === "/dashboard"
              ? "border-[#00E676] bg-primary/10 text-[#00E676]"
              : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          数据看板
        </Link>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 border-l-2 px-3 py-2 font-mono text-[13px] transition-colors",
                active
                  ? "border-[#00E676] bg-primary/10 text-[#00E676]"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
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
