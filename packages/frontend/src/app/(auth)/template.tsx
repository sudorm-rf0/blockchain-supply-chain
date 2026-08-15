"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** 登录/注册等认证页切换时的柔和淡入 */
export default function AuthTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in">
      {children}
    </div>
  );
}
