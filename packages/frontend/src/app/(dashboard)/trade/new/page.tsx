"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { useUserStore } from "@/stores/user-store";
import { parseUsdcInput } from "@/lib/http";
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
import { Textarea } from "@/components/ui/textarea";
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
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState("");
  const [tenorDays, setTenorDays] = useState("30");
  const [sellerWallet, setSellerWallet] = useState("");
  const [orderName, setOrderName] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    downPayment: string;
    poolPortion: string;
    tradeId: string;
  } | null>(null);

  // 贸易订单创建仅限管理员/超级管理员
  if (user && user.role === "USER") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <p className="rounded-md border border-red-500/50 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          {t("trade.errors.unauthorized")}
        </p>
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setQuote(null);

    if (!connected || !publicKey) {
      setError(t("trade.errors.connectWallet"));
      return;
    }

    // 审计中危-3：金额用字符串/BigInt 解析为 uUSDC，避免浮点精度问题。
    const amountRaw = parseUsdcInput(amount);
    if (amountRaw === null) {
      setError(t("trade.errors.invalidAmount"));
      return;
    }
    const seller = sellerWallet.trim();
    if (
      seller &&
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(seller)
    ) {
      setError(t("trade.errors.invalidSeller"));
      return;
    }

    setSubmitting(true);
    try {
      const response = await createTrade(
        {
          buyerWallet: publicKey.toBase58(),
          sellerWallet: sellerWallet.trim() || publicKey.toBase58(),
          amount: amountRaw,
          tenor: tenorDays,
          name: orderName.trim() || null,
          remark: remark.trim() || null,
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
        amount: amountRaw,
        tenor: tenorDays,
        txSignature,
        name: orderName.trim() || null,
        remark: remark.trim() || null,
      });

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-primary">DFR SUPPLY CHAIN</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            {t("trade.title")}
          </h1>
        </div>
        <WalletConnectButton />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("trade.parameters")}</CardTitle>
          <CardDescription>{t("trade.parametersDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="amount">{t("trade.amountLabel")}</Label>
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
              <Label htmlFor="tenor">{t("trade.tenorLabel")}</Label>
              <Select value={tenorDays} onValueChange={setTenorDays}>
                <SelectTrigger id="tenor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENOR_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {t("trade.days", { count: days })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sellerWallet">{t("trade.sellerLabel")}</Label>
              <Input
                id="sellerWallet"
                type="text"
                value={sellerWallet}
                onChange={(event) => setSellerWallet(event.target.value)}
                placeholder={t("trade.sellerPlaceholder")}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orderName">{t("trade.nameLabel")}</Label>
              <Input
                id="orderName"
                type="text"
                value={orderName}
                onChange={(event) => setOrderName(event.target.value)}
                placeholder={t("trade.namePlaceholder")}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="remark">{t("trade.remarkLabel")}</Label>
              <Textarea
                id="remark"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                placeholder={t("trade.remarkPlaceholder")}
                maxLength={500}
                rows={3}
              />
            </div>

            {connected && publicKey && (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {t("trade.buyer")}: {publicKey.toBase58()}
              </p>
            )}

            {quote && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                <p>
                  {t("trade.downPayment")}: ${formatUsdc(quote.downPayment)}
                </p>
                <p className="mt-1">
                  {t("trade.poolPortion")}: ${formatUsdc(quote.poolPortion)}
                </p>
                <p className="mt-1 font-mono text-xs opacity-80">
                  tradeId: {quote.tradeId}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => router.push("/orders")}
                >
                  {t("trade.viewOrders")}
                </Button>
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
              {submitting ? t("trade.submitting") : t("trade.submit")}
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
