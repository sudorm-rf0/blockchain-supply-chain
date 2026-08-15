"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** 后台路由切换时的柔和淡入（内容区） */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in">
      {children}
    </div>
  );
}
