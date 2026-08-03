"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RepaymentCountdown } from "@/components/RepaymentCountdown";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildAdvanceTrade,
  buildDefaultTrade,
  buildFundTrade,
  buildRepayTrade,
  confirmAdvanceTrade,
  confirmDefaultTrade,
  confirmFundTrade,
  confirmReleaseTrade,
  confirmRepayTrade,
  buildReleaseTrade,
  fetchMyTrades,
  formatUsdc,
  type TradeRecord,
} from "@/lib/api";
import { useUserStore } from "@/stores/user-store";
import { formatDateTime } from "@/lib/format";
import {
  CAN_DEFAULT_TRADE,
  NEXT_TRADE_STATUS,
  TRADE_STATUS_STYLE,
} from "@/lib/status";

export default function OrdersPage() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const user = useUserStore((state) => state.user);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrades(await fetchMyTrades());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const signAndConfirm = async (
    tradeId: string,
    build: () => Promise<{ transaction: string }>,
    confirm: (signature: string) => Promise<{ status: string }>,
  ) => {
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
      return;
    }
    setBusyId(tradeId);
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
      setBusyId(null);
    }
  };

  const onFund = (trade: TradeRecord) =>
    void signAndConfirm(
      trade.tradeId,
      () => buildFundTrade(trade.tradeId, publicKey!.toBase58()),
      (signature) => confirmFundTrade(trade.tradeId, signature),
    );

  const onAdvance = (trade: TradeRecord) => {
    const next = NEXT_TRADE_STATUS[trade.status];
    if (!next || !publicKey) return;
    return void signAndConfirm(
      trade.tradeId,
      () => buildAdvanceTrade(trade.tradeId, next.code, publicKey.toBase58()),
      (signature) =>
        confirmAdvanceTrade(
          trade.tradeId,
          next.code,
          publicKey.toBase58(),
          signature,
        ),
    );
  };

  const onRepay = (trade: TradeRecord) =>
    void signAndConfirm(
      trade.tradeId,
      () => buildRepayTrade(trade.tradeId),
      (signature) => confirmRepayTrade(trade.tradeId, signature),
    );

  const onDefault = (trade: TradeRecord) =>
    void signAndConfirm(
      trade.tradeId,
      () => buildDefaultTrade(trade.tradeId, publicKey!.toBase58()),
      (signature) => confirmDefaultTrade(trade.tradeId, signature),
    );

  const onRelease = (trade: TradeRecord) =>
    void signAndConfirm(
      trade.tradeId,
      () => buildReleaseTrade(trade.tradeId, publicKey!.toBase58()),
      (signature) => confirmReleaseTrade(trade.tradeId, signature),
    );

  const isAdmin = user?.role === "ADMIN";
  const isBuyer = Boolean(user?.wallet);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">我的订单</h1>
        <WalletConnectButton />
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无订单</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>订单 ID</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>首付</TableHead>
                <TableHead>垫付</TableHead>
                <TableHead>账期</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => {
                const canFund = isAdmin && trade.status === "PENDING";
                const canAdvance =
                  isAdmin && NEXT_TRADE_STATUS[trade.status] !== undefined;
                const canRepay =
                  isBuyer &&
                  trade.status === "REPAYING" &&
                  user?.wallet === trade.buyerWallet;
                const canDefault =
                  isAdmin && CAN_DEFAULT_TRADE.has(trade.status);
                const canRelease = isAdmin && trade.status === "DELIVERED";
                return (
                  <TableRow key={trade.id}>
                    <TableCell className="font-mono text-xs">
                      {trade.tradeId}
                    </TableCell>
                    <TableCell>{formatUsdc(trade.amount)} USDC</TableCell>
                    <TableCell>{formatUsdc(trade.downPayment)}</TableCell>
                    <TableCell>{formatUsdc(trade.poolPortion)}</TableCell>
                    <TableCell>{Math.round(trade.tenor / 86400)} 天</TableCell>
                    <TableCell>
                      <Badge className={TRADE_STATUS_STYLE[trade.status] ?? ""}>
                        {trade.status}
                      </Badge>
                      <RepaymentCountdown
                        createdAt={trade.createdAt}
                        tenorSeconds={trade.tenor}
                        status={trade.status}
                      />
                    </TableCell>
                    <TableCell>
                      {formatDateTime(trade.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="space-x-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/orders/${trade.tradeId}`}>详情</Link>
                        </Button>
                        {canFund && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onFund(trade)}
                          >
                            拨款
                          </Button>
                        )}
                        {canAdvance && NEXT_TRADE_STATUS[trade.status] && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onAdvance(trade)}
                          >
                            {NEXT_TRADE_STATUS[trade.status]!.label}
                          </Button>
                        )}
                        {canRepay && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onRepay(trade)}
                          >
                            还款
                          </Button>
                        )}
                        {canDefault && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onDefault(trade)}
                          >
                            标记违约
                          </Button>
                        )}
                        {canRelease && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onRelease(trade)}
                          >
                            释放资金并还款
                          </Button>
                        )}
                        {!canFund &&
                          !canAdvance &&
                          !canRepay &&
                          !canDefault &&
                          !canRelease &&
                          "-"}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
