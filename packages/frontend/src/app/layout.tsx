import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import AppWalletProvider from "@/components/WalletProvider";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Supply Chain Traceability",
  description: "Solana supply chain traceability dashboard",
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
      <body className={inter.className}>
        <ThemeProvider nonce={nonce}>
          <AppWalletProvider>{children}</AppWalletProvider>
          <Toaster />
          <RegisterServiceWorker />
        </ThemeProvider>
      </body>
    </html>
  );
}
