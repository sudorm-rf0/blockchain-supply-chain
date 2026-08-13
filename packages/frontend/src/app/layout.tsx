import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import AppWalletProvider from "@/components/WalletProvider";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "供应链金融 · 区块链存证平台",
  description: "Solana 供应链金融存证平台：单据上传审核、链上存证、贸易订单与资金池看板",
  manifest: "/manifest.webmanifest",
  other: {
    // 阻止浏览器/翻译扩展自动翻译本站，避免注入 DOM 破坏 React 水合
    google: "notranslate",
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="zh-CN" translate="no" suppressHydrationWarning>
      {/* 使用系统字体栈，避免构建期从 Google Fonts 拉取字体（境内 VPS 无法访问） */}
      <body className="antialiased">
        <ThemeProvider nonce={nonce}>
          <AppWalletProvider>{children}</AppWalletProvider>
          <Toaster />
          <RegisterServiceWorker />
        </ThemeProvider>
      </body>
    </html>
  );
}
