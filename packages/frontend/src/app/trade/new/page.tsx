"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TransactionStatusToast } from "@/components/TransactionStatusToast";
import {
  createTrade,
  formatUsdc,
} from "@/lib/api";

const TENOR_OPTIONS = [30, 60, 90, 120];

export default function NewTradePage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState("");
  const [tenorDays, setTenorDays] = useState("30");
  const [sellerWallet, setSellerWallet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    downPayment: string;
    poolPortion: string;
    tradeId: string;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setQuote(null);

    if (!connected || !publicKey) {
      setError("Connect a wallet before creating a trade.");
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid trade amount.");
      return;
    }

    setSubmitting(true);
    try {
      const amountRaw = BigInt(Math.round(numericAmount * 1_000_000));
      const response = await createTrade(
        {
          buyerWallet: publicKey.toBase58(),
          sellerWallet: sellerWallet.trim() || publicKey.toBase58(),
          amount: amountRaw.toString(10),
          tenor: tenorDays,
        },
      );

      const transaction = Transaction.from(
        Buffer.from(response.transaction, "base64"),
      );
      const txSignature = await sendTransaction(transaction, connection);

      setQuote({
        downPayment: response.downPayment,
        poolPortion: response.poolPortion,
        tradeId: response.tradeId,
      });
      setSignature(txSignature);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-400">SOLANA SUPPLY CHAIN</p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-100">New Trade</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300"
          >
            Dashboard
          </Link>
          <WalletMultiButton />
        </div>
      </header>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-300">贸易金额 (USDC)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1000.00"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-emerald-500"
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-300">账期</span>
            <select
              value={tenorDays}
              onChange={(event) => setTenorDays(event.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-emerald-500"
            >
              {TENOR_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} 天
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-300">卖方钱包（可选）</span>
            <input
              type="text"
              value={sellerWallet}
              onChange={(event) => setSellerWallet(event.target.value)}
              placeholder="默认使用买方钱包"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-zinc-100 outline-none transition focus:border-emerald-500"
            />
          </label>

          {connected && publicKey && (
            <p className="truncate font-mono text-xs text-zinc-500">
              Buyer: {publicKey.toBase58()}
            </p>
          )}

          {quote && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm">
              <p className="text-zinc-200">
                30% 首付: ${formatUsdc(quote.downPayment)}
              </p>
              <p className="mt-1 text-zinc-200">
                70% 池垫付: ${formatUsdc(quote.poolPortion)}
              </p>
              <p className="mt-1 font-mono text-xs text-zinc-400">
                tradeId: {quote.tradeId}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-red-500/50 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !connected}
            className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Preparing..." : "Pre-build & Sign"}
          </button>
        </form>
      </section>

      <TransactionStatusToast
        signature={signature}
        connection={connection}
        onDismiss={() => setSignature(null)}
      />
    </main>
  );
}
