"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { Eye, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { RepaymentCountdown } from "@/components/RepaymentCountdown";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import {
  buildAdvanceTrade,
  buildDefaultTrade,
  buildFundTrade,
  buildReleaseTrade,
  buildRepayTrade,
  confirmAdvanceTrade,
  confirmDefaultTrade,
  confirmFundTrade,
  confirmReleaseTrade,
  confirmRepayTrade,
  fetchTrade,
  formatUsdc,
  getFiles,
  type FileRecord,
  type TradeRecord,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useUserStore } from "@/stores/user-store";
import {
  CAN_DEFAULT_TRADE,
  NEXT_TRADE_STATUS,
  TRADE_LIFECYCLE,
  TRADE_STATUS_STYLE,
} from "@/lib/status";

export default function TradeDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ tradeId: string }>();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const user = useUserStore((state) => state.user);
  const [trade, setTrade] = useState<TradeRecord | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const tradeStatusLabel = (status: string) =>
    t(`orders.status.${status}`, { defaultValue: status });

  const advanceLabel = (status: string) =>
    t(`orders.advance.${status}`, {
      defaultValue: t("orders.action.advanceStatus"),
    });

  const load = useCallback(async () => {
    try {
      const [tradeData, fileData] = await Promise.all([
        fetchTrade(params.tradeId),
        getFiles({ page: 1, limit: 50, tradeId: params.tradeId }),
      ]);
      setTrade(tradeData);
      setFiles(fileData.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [params.tradeId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const signAndConfirm = async (
    build: () => Promise<{ transaction: string }>,
    confirm: (signature: string) => Promise<{ status: string }>,
  ) => {
    if (!trade) return;
    if (!connected || !publicKey) {
      toast.error(t("orders.toast.connectWallet"));
      return;
    }
    setBusy(true);
    try {
      const built = await build();
      const transaction = Transaction.from(
        Buffer.from(built.transaction, "base64"),
      );
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirm(signature);
      toast.success(
        t("orders.toast.statusUpdated", {
          status: tradeStatusLabel(result.status),
        }),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.toast.chainFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("orders.loading")}</p>;
  }
  if (!trade) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("orders.detail.notFound")}</p>
        <Button variant="outline" asChild>
          <Link href="/orders">{t("orders.detail.backToList")}</Link>
        </Button>
      </div>
    );
  }

  const isAdmin = user?.role !== "USER";
  const canFund = isAdmin && trade.status === "PENDING";
  const canAdvance = isAdmin && NEXT_TRADE_STATUS[trade.status] !== undefined;
  const canRepay =
    user?.role === "USER" &&
    trade.status === "REPAYING" &&
    user.wallet === trade.buyerWallet;
  const canDefault = isAdmin && CAN_DEFAULT_TRADE.has(trade.status);
  const canRelease = isAdmin && trade.status === "DELIVERED";

  const rows: Array<[string, string]> = [
    [t("orders.detail.id"), trade.tradeId],
    [t("orders.detail.amount"), `${formatUsdc(trade.amount)} USDC`],
    [t("orders.detail.downPayment"), `${formatUsdc(trade.downPayment)} USDC`],
    [t("orders.detail.poolPortion"), `${formatUsdc(trade.poolPortion)} USDC`],
    [
      t("orders.detail.tenor"),
      t("orders.days", { count: Math.round(trade.tenor / 86400) }),
    ],
    [t("orders.detail.buyer"), trade.buyerWallet],
    [t("orders.detail.seller"), trade.sellerWallet],
    [t("orders.detail.createdAt"), formatDateTime(trade.createdAt)],
    [t("orders.detail.txSignature"), trade.txSignature ?? t("orders.detail.notOnChain")],
    [t("orders.detail.logisticsHash"), trade.logisticsHash ?? "-"],
  ];

  const currentIndex = TRADE_LIFECYCLE.indexOf(trade.status);
  const isDefaulted = trade.status === "DEFAULTED";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{t("orders.detail.title")}</h1>
          <Badge className={TRADE_STATUS_STYLE[trade.status] ?? ""}>
            {tradeStatusLabel(trade.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <WalletConnectButton />
          <Button variant="outline" asChild>
            <Link href="/orders">{t("orders.detail.back")}</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-base">
            {trade.tradeId}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto pb-1">
            <ol className="flex min-w-[560px] items-center gap-1 text-xs">
              {TRADE_LIFECYCLE.map((step, index) => {
                const done = !isDefaulted && index <= currentIndex;
                const current = !isDefaulted && index === currentIndex;
                return (
                  <li key={step} className="flex items-center gap-1">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-1 ${
                        done
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      } ${current ? "ring-1 ring-primary" : ""}`}
                    >
                      {step}
                    </span>
                    {index < TRADE_LIFECYCLE.length - 1 && (
                      <span className="h-px w-4 bg-muted-foreground/30" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {isDefaulted && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30">
              {t("orders.detail.defaultedNote")}
            </p>
          )}

          {trade.status === "REPAYING" && (
            <div className="rounded-md bg-orange-50 p-3 dark:bg-orange-950/30">
              <RepaymentCountdown
                createdAt={trade.createdAt}
                tenorSeconds={trade.tenor}
                status={trade.status}
              />
            </div>
          )}

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>

          {(canFund ||
            canAdvance ||
            canRepay ||
            canDefault ||
            canRelease) && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {canFund && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void signAndConfirm(
                      () =>
                        buildFundTrade(trade.tradeId, publicKey!.toBase58()),
                      (signature) => confirmFundTrade(trade.tradeId, signature),
                    )
                  }
                >
                  {t("orders.action.fund")}
                </Button>
              )}
              {canAdvance && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    const next = NEXT_TRADE_STATUS[trade.status];
                    if (!next) return;
                    void signAndConfirm(
                      () =>
                        buildAdvanceTrade(
                          trade.tradeId,
                          next.code,
                          publicKey!.toBase58(),
                        ),
                      (signature) =>
                        confirmAdvanceTrade(
                          trade.tradeId,
                          next.code,
                          publicKey!.toBase58(),
                          signature,
                        ),
                    );
                  }}
                >
                  {advanceLabel(trade.status)}
                </Button>
              )}
              {canRelease && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void signAndConfirm(
                      () =>
                        buildReleaseTrade(
                          trade.tradeId,
                          publicKey!.toBase58(),
                        ),
                      (signature) =>
                        confirmReleaseTrade(trade.tradeId, signature),
                    )
                  }
                >
                  {t("orders.action.releasePayment")}
                </Button>
              )}
              {canRepay && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void signAndConfirm(
                      () => buildRepayTrade(trade.tradeId),
                      (signature) => confirmRepayTrade(trade.tradeId, signature),
                    )
                  }
                >
                  {t("orders.action.repay")}
                </Button>
              )}
              {canDefault && (
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void signAndConfirm(
                      () =>
                        buildDefaultTrade(
                          trade.tradeId,
                          publicKey!.toBase58(),
                        ),
                      (signature) => confirmDefaultTrade(trade.tradeId, signature),
                    )
                  }
                >
                  {t("orders.action.default")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("orders.detail.relatedFiles", { count: files.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("orders.detail.noFiles")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {file.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      v{file.version ?? 1}
                      {file.isLatest === false ? t("orders.detail.updated") : ""} ·{" "}
                      {formatDateTime(file.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewId(file.id)}
                  >
                    <Eye className="mr-1 h-3 w-3" />
                    {t("orders.action.preview")}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" asChild>
            <Link
              href={`/user/upload?tradeId=${encodeURIComponent(trade.tradeId)}`}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {t("orders.action.uploadDocs")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <FilePreviewDialog
        open={previewId !== null}
        onOpenChange={(open) => setPreviewId(open ? previewId : null)}
        fileId={previewId}
      />
    </div>
  );
}
