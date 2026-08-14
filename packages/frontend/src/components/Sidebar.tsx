"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ClipboardCheck, Banknote, Files, LayoutDashboard, ReceiptText, ScrollText, ShieldCheck, Upload, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface SidebarProps {
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
}

export function Sidebar({ role }: SidebarProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const items =
    isAdmin
      ? [
          ...(role === "SUPER_ADMIN"
            ? [{ href: "/admin/accounts", label: t("sidebar.accounts"), icon: ShieldCheck }]
            : []),
          {
            href: "/admin/files?status=PENDING",
            label: t("sidebar.fileReview"),
            icon: ClipboardCheck,
          },
          { href: "/admin/audit", label: t("sidebar.auditLog"), icon: ScrollText },
          { href: "/admin/trades", label: t("sidebar.allOrders"), icon: ReceiptText },
          { href: "/admin/supply-chain", label: t("sidebar.supplyChain"), icon: Boxes },
          { href: "/admin/security", label: t("sidebar.security"), icon: ShieldCheck },
          { href: "/admin/withdrawals", label: t("sidebar.withdrawals"), icon: Banknote },
          { href: "/admin/financing", label: t("sidebar.financingReview"), icon: Banknote },
          { href: "/account", label: t("sidebar.accountInfo"), icon: UserCog },
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
          { href: "/account", label: t("sidebar.accountInfo"), icon: UserCog },
        ];

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-background">
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
          {t("sidebar.dashboard")}
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
