"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { fetchSession, logout as logoutApi } from "@/lib/api";
import { useUserStore } from "@/stores/user-store";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, hydrated, setHydrated } = useUserStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await fetchSession();
      if (!active) return;
      setHydrated(true);
      if (!session) {
        // fetchSession 失败时由 api 层完成登出跳转。
        setHydrated(true);
      }
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
    if (pathname.startsWith("/admin") && user.role !== "ADMIN") {
      router.replace("/user/files");
    } else if (pathname.startsWith("/user") && user.role !== "USER") {
      router.replace("/admin/files");
    }
  }, [hydrated, user, pathname, router]);

  if (!hydrated || !user) {
    return null;
  }

  const role = user.role;

  const handleLogout = async () => {
    await logoutApi();
    toast.success("已退出登录");
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block">
        <Sidebar role={role} />
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed left-4 top-4 z-40 md:hidden"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar role={role} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-background px-6">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded bg-primary" />
            <span className="font-semibold">Supply Chain</span>
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
                <DropdownMenuLabel>{user?.name ?? "未登录"}</DropdownMenuLabel>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {user?.email ?? ""}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
