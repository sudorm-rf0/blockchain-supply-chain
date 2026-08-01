import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import AppWalletProvider from "@/components/WalletProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Supply Chain Traceability",
  description: "Solana supply chain traceability dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <AppWalletProvider>{children}</AppWalletProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
