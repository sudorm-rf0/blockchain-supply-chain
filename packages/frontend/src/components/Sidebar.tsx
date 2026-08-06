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
  role: "USER" | "ADMIN";
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const items =
    role === "ADMIN"
      ? [
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
    <aside className="flex h-screen w-64 flex-col border-r bg-white dark:bg-slate-900">
      <div className="px-5 py-4 text-base font-semibold text-foreground">
        Supply Chain
      </div>
      <nav className="flex-1 space-y-1 p-2">
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            pathname === "/dashboard"
              ? "bg-slate-700 text-white dark:bg-primary/10 dark:text-primary"
              : "text-muted-foreground hover:bg-muted",
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
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-slate-700 text-white dark:bg-primary/10 dark:text-primary"
                  : "text-muted-foreground hover:bg-muted",
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
