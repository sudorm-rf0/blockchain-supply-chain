"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

export function useWalletContext() {
  const wallet = useWallet();
  const { connection } = useConnection();

  return {
    ...wallet,
    connection,
  };
}

export type WalletContext = ReturnType<typeof useWalletContext>;
