"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WalletConnectButton() {
  const { connected, connecting, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <Button type="button" disabled className="w-40">连接钱包</Button>;
  }

  if (connected && publicKey) {
    const short = `${publicKey.toBase58().slice(0, 4)}...${publicKey
      .toBase58()
      .slice(-4)}`;
    return (
      <Button type="button" variant="outline" onClick={() => void disconnect()}>
        <Wallet className="h-4 w-4" />
        {short}
      </Button>
    );
  }

  return (
    <Button type="button" disabled={connecting} onClick={() => setVisible(true)}>
      <Wallet className="h-4 w-4" />
      {connecting ? "连接中..." : "连接钱包"}
    </Button>
  );
}
