"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { UnsolvedBloomWalletAdapter } from "@/components/adapters/UnsolvedBloomWalletAdapter";

const DEVNET_RPC = "https://api.devnet.solana.com";

export default function AppWalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // RPC 端点统一由 NEXT_PUBLIC_RPC_URL 配置（部署/本地一致），不再硬编码 Devnet 网络。
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? DEVNET_RPC,
    [],
  );
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new BackpackWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new UnsolvedBloomWalletAdapter(),
    ],
    [],
  );
  if (!mounted) return <>{children}</>;

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
