"use client";

import Link from "next/link";
import {
  Landmark,
  ShieldCheck,
  FileCheck2,
  ArrowRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

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

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* 品牌左栏（桌面端显示） */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="relative z-10">
          <Link href="/login" className="inline-flex items-center gap-3 text-lg font-semibold tracking-wide">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 text-base font-bold shadow-lg shadow-indigo-500/30">
              链
            </span>
            供应链金融 · 区块链存证
          </Link>
        </div>

        <div className="relative z-10 space-y-8">
          {features.map((f) => (
            <div key={f.title} className="flex items-start gap-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <f.icon className="h-5 w-5 text-indigo-300" />
              </span>
              <div>
                <p className="font-medium text-slate-50">{f.title}</p>
                <p className="mt-0.5 text-sm text-slate-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-2 text-sm text-slate-400">
          Solana · Anchor 供应链金融平台
          <ArrowRight className="h-4 w-4" />
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
