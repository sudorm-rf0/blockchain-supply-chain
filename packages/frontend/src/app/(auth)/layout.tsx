"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Landmark,
  ShieldCheck,
  FileCheck2,
  ArrowRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoMark } from "@/components/LogoMark";

const features = [
  {
    icon: ShieldCheck,
    title: "链上存证 · 不可篡改",
    desc: "单据哈希实时上链，Solana 链上可核验",
  },
  {
    icon: FileCheck2,
    title: "单据审核 · 全流程留痕",
    desc: "上传 → 审核 → 存证 → 归档，审计日志可追溯",
  },
  {
    icon: Landmark,
    title: "资金池 · 透明可查",
    desc: "NAV 实时计算，LP 铸造/赎回公开透明",
  },
];

/** 实时 UTC 时钟（真实信息，非伪造数据） */
function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  const utc = useUtcClock();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* 品牌左栏（桌面端显示）：Industrial 终端面板 */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#000] p-10 text-[#EDEDED] lg:flex">
        {/* 发丝网格 */}
        <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] [background-size:40px_40px]" />
        {/* 顶部：品牌 + 在线状态（CSS 方块，非 unicode 图标） */}
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/login" className="inline-flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <span className="font-mono text-sm tracking-widest">
              DFR 区块链 · 供应链系统
            </span>
          </Link>
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#00E676]">
            <span className="h-1.5 w-1.5 bg-[#00E676]" />
            LIVE
          </span>
        </div>

        {/* 中部：终端信息块（真实信息） */}
        <div className="relative z-10 border border-white/15 bg-black/70 p-5 font-mono text-[13px] leading-relaxed">
          <div className="mb-3 flex items-center gap-2 text-[#00E676]">
            <span className="h-2 w-2 bg-[#00E676]" />
            SYSTEM ONLINE
          </div>
          <div className="space-y-1.5">
            <div>平台：DFR 区块链 · 供应链系统</div>
            <div className="text-[#8A8A8A]">网络：Solana · Anchor</div>
            <div className="text-[#8A8A8A]">链路：单据哈希实时上链，链上可核验</div>
            <div className="text-[#8A8A8A]">时钟：{utc}</div>
            <div className="text-[#00E676]">
              <span className="cursor-blink inline-block h-3.5 w-2 translate-y-0.5 bg-[#00E676]" />
            </div>
          </div>
        </div>

        {/* 特性列表 */}
        <div className="relative z-10 space-y-5">
          {features.map((f) => (
            <div key={f.title} className="flex items-start gap-3 border-l border-white/15 pl-4">
              <f.icon className="mt-0.5 h-4 w-4 text-[#00E676]" />
              <div>
                <p className="font-mono text-sm text-[#EDEDED]">{f.title}</p>
                <p className="mt-0.5 text-xs text-[#8A8A8A]">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-2 font-mono text-xs text-[#8A8A8A]">
          Solana · Anchor DFR 供应链系统
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </div>

      {/* 表单右栏 */}
      <div className="relative flex items-center justify-center bg-background p-6">
        <div className="absolute right-6 top-6">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
