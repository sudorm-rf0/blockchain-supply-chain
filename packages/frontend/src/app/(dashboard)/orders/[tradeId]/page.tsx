"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-200 text-yellow-800",
  FUNDED: "bg-blue-200 text-blue-800",
  IN_TRANSIT: "bg-indigo-200 text-indigo-800",
  CUSTOMS_CLEAR: "bg-cyan-200 text-cyan-800",
  DELIVERED: "bg-teal-200 text-teal-800",
  REPAYING: "bg-orange-200 text-orange-800",
  SETTLED: "bg-green-200 text-green-800",
  DEFAULTED: "bg-red-200 text-red-800",
};

const LIFECYCLE = [
  "PENDING",
  "FUNDED",
  "IN_TRANSIT",
  "CUSTOMS_CLEAR",
  "DELIVERED",
  "REPAYING",
  "SETTLED",
];

const NEXT_STATUS: Record<string, { code: number; label: string } | null> = {
  FUNDED: { code: 2, label: "推进至运输中" },
  IN_TRANSIT: { code: 3, label: "推进至清关" },
  CUSTOMS_CLEAR: { code: 4, label: "推进至已交付" },
};

const CAN_DEFAULT = new Set([
  "FUNDED",
  "IN_TRANSIT",
  "CUSTOMS_CLEAR",
  "DELIVERED",
]);

export default function TradeDetailPage() {
  const params = useParams<{ tradeId: string }>();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const user = useUserStore((state) => state.user);
  const [trade, setTrade] = useState<TradeRecord | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tradeData, fileData] = await Promise.all([
        fetchTrade(params.tradeId),
        getFiles({ page: 1, limit: 50, tradeId: params.tradeId }),
      ]);
      setTrade(tradeData);
      setFiles(fileData.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, [params.tradeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const signAndConfirm = async (
    build: () => Promise<{ transaction: string }>,
    confirm: (signature: string) => Promise<{ status: string }>,
  ) => {
    if (!trade) return;
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
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
      toast.success(`订单状态已更新：${result.status}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "链上操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中...</p>;
  }
  if (!trade) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">订单不存在</p>
        <Button variant="outline" asChild>
          <Link href="/orders">返回订单列表</Link>
        </Button>
      </div>
    );
  }

  const isAdmin = user?.role === "ADMIN";
  const canFund = isAdmin && trade.status === "PENDING";
  const canAdvance = isAdmin && NEXT_STATUS[trade.status] !== undefined;
  const canRepay =
    user?.role === "USER" &&
    trade.status === "REPAYING" &&
    user.wallet === trade.buyerWallet;
  const canDefault = isAdmin && CAN_DEFAULT.has(trade.status);
  const canRelease = isAdmin && trade.status === "DELIVERED";

  const rows: Array<[string, string]> = [
    ["订单 ID", trade.tradeId],
    ["金额", `${formatUsdc(trade.amount)} USDC`],
    ["30% 首付", `${formatUsdc(trade.downPayment)} USDC`],
    ["70% 垫付", `${formatUsdc(trade.poolPortion)} USDC`],
    ["账期", `${Math.round(trade.tenor / 86400)} 天`],
    ["买方", trade.buyerWallet],
    ["卖方", trade.sellerWallet],
    ["创建时间", formatDateTime(trade.createdAt)],
    ["交易签名", trade.txSignature ?? "未上链"],
    ["物流哈希", trade.logisticsHash ?? "-"],
  ];

  const currentIndex = LIFECYCLE.indexOf(trade.status);
  const isDefaulted = trade.status === "DEFAULTED";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">订单详情</h1>
          <Badge className={STATUS_STYLE[trade.status] ?? ""}>
            {trade.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <WalletConnectButton />
          <Button variant="outline" asChild>
            <Link href="/orders">返回列表</Link>
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
              {LIFECYCLE.map((step, index) => {
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
                    {index < LIFECYCLE.length - 1 && (
                      <span className="h-px w-4 bg-muted-foreground/30" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {isDefaulted && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30">
              该订单已违约：30% 抵押金已清算，保险基金完成赔付。
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
                  拨款
                </Button>
              )}
              {canAdvance && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    const next = NEXT_STATUS[trade.status];
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
                  {NEXT_STATUS[trade.status]?.label ?? "推进状态"}
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
                  释放货款
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
                  还款
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
                  标记违约
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">关联单据（{files.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无关联单据</p>
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
                      {file.isLatest === false ? "（已更新）" : ""} ·{" "}
                      {formatDateTime(file.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewId(file.id)}
                  >
                    <Eye className="mr-1 h-3 w-3" />
                    预览
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
              上传关联单据
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
