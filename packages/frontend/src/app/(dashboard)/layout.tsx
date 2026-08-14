"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Languages, LogOut, Menu, User as UserIcon, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/Sidebar";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { fetchSession, logout as logoutApi } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";
import { useLanguage } from "@/components/LanguageProvider";
import { LOCALE_NAMES, type SupportedLocale } from "@/locales";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, hydrated, setHydrated } = useUserStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { locale, setLocale } = useLanguage();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    void (async () => {
      // fetchSession 失败时由 api 层完成登出跳转，这里只负责结束加载态。
      await fetchSession();
      if (active) setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, [setHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.mustChangePassword && pathname !== "/change-password") {
      router.replace("/change-password");
      return;
    }
    if (pathname.startsWith("/admin") && user.role === "USER") {
      router.replace("/user/files");
    } else if (pathname.startsWith("/user") && user.role !== "USER") {
      router.replace("/admin/files");
    }
  }, [hydrated, user, pathname, router]);

  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const role = user.role;

  const handleLogout = async () => {
    await logoutApi();
    toast.success(t("shell.logoutSuccess"));
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block">
        <Sidebar role={role} />
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="fixed left-4 top-4 z-40 md:hidden">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar role={role} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="font-mono font-semibold tracking-wide">{t("shell.appName")}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button">
                  <Avatar>
                    <AvatarFallback>
                      <UserIcon className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user?.name ?? t("shell.notSignedIn")}</DropdownMenuLabel>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {user?.email ?? ""}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Languages className="mr-2 h-4 w-4" />
                    {t("shell.changeLanguage")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={locale}
                      onValueChange={(v) => setLocale(v as SupportedLocale)}
                    >
                      {SUPPORTED_LOCALES.map((l) => (
                        <DropdownMenuRadioItem key={l} value={l}>
                          {LOCALE_NAMES[l as SupportedLocale]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={() => router.push("/account")}>
                  <UserCog className="mr-2 h-4 w-4" />
                  {t("account.manageAccountInfo")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("shell.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
