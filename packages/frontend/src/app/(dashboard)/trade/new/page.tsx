"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { TransactionStatusToast } from "@/components/TransactionStatusToast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  confirmTrade,
  createTrade,
  formatUsdc,
} from "@/lib/api";

const TENOR_OPTIONS = [30, 60, 90, 120];

export default function NewTradePage() {
  const router = useRouter();
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
      await confirmTransactionWithTimeout(connection, txSignature, "confirmed");
      await confirmTrade(response.tradeId, {
        buyerWallet: publicKey.toBase58(),
        sellerWallet: sellerWallet.trim() || publicKey.toBase58(),
        amount: amountRaw.toString(10),
        tenor: tenorDays,
        txSignature,
      });

      setQuote({
        downPayment: response.downPayment,
        poolPortion: response.poolPortion,
        tradeId: response.tradeId,
      });
      setSignature(txSignature);
      router.push("/orders");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-primary">SOLANA SUPPLY CHAIN</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">创建贸易订单</h1>
        </div>
        <WalletConnectButton />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">订单参数</CardTitle>
          <CardDescription>
            预构建交易由资金池服务完成，钱包确认签名后上链
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="amount">贸易金额（USDC）</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1000.00"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenor">账期</Label>
              <Select value={tenorDays} onValueChange={setTenorDays}>
                <SelectTrigger id="tenor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENOR_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days} 天
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sellerWallet">卖方钱包（可选）</Label>
              <Input
                id="sellerWallet"
                type="text"
                value={sellerWallet}
                onChange={(event) => setSellerWallet(event.target.value)}
                placeholder="默认使用买方钱包"
                className="font-mono text-sm"
              />
            </div>

            {connected && publicKey && (
              <p className="truncate font-mono text-xs text-muted-foreground">
                Buyer: {publicKey.toBase58()}
              </p>
            )}

            {quote && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                <p>30% 首付: ${formatUsdc(quote.downPayment)}</p>
                <p className="mt-1">70% 池垫付: ${formatUsdc(quote.poolPortion)}</p>
                <p className="mt-1 font-mono text-xs opacity-80">
                  tradeId: {quote.tradeId}
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-md border border-red-500/50 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting || !connected}
              className="w-full"
            >
              {submitting ? "Preparing..." : "Pre-build & Sign"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <TransactionStatusToast
        signature={signature}
        connection={connection}
        onDismiss={() => setSignature(null)}
      />
    </main>
  );
}
