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
  title: "DFR 区块链 · 供应链系统",
  description: "DFR 区块链供应链系统：单据上传审核、链上存证、贸易订单与资金池看板",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
