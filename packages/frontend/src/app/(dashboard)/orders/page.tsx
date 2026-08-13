"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Transaction } from "@solana/web3.js";
import { confirmTransactionWithTimeout } from "@/lib/solana";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RepaymentCountdown } from "@/components/RepaymentCountdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const { t } = useTranslation();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const user = useUserStore((state) => state.user);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const tradeStatusLabel = (status: string) =>
    t(`orders.status.${status}`, { defaultValue: status });

  const advanceLabel = (status: string) =>
    t(`orders.advance.${status}`, {
      defaultValue: t("orders.action.advanceStatus"),
    });

  const load = useCallback(async () => {
    try {
      setTrades(
        await fetchMyTrades({
          search: search.trim() || undefined,
          status: statusFilter,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, t]);

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
      toast.error(t("orders.toast.connectWallet"));
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
      toast.success(
        t("orders.toast.statusUpdated", { status: tradeStatusLabel(result.status) }),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("orders.toast.chainFailed"));
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

  const isAdmin = user?.role !== "USER";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("orders.title")}</h1>
        <WalletConnectButton />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("orders.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("orders.filterAll")}</SelectItem>
            <SelectItem value="PENDING">{t("orders.status.PENDING")}</SelectItem>
            <SelectItem value="FUNDED">{t("orders.status.FUNDED")}</SelectItem>
            <SelectItem value="IN_TRANSIT">{t("orders.status.IN_TRANSIT")}</SelectItem>
            <SelectItem value="CUSTOMS_CLEAR">{t("orders.status.CUSTOMS_CLEAR")}</SelectItem>
            <SelectItem value="DELIVERED">{t("orders.status.DELIVERED")}</SelectItem>
            <SelectItem value="REPAYING">{t("orders.status.REPAYING")}</SelectItem>
            <SelectItem value="SETTLED">{t("orders.status.SETTLED")}</SelectItem>
            <SelectItem value="DEFAULTED">{t("orders.status.DEFAULTED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("orders.loading")}</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("orders.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.columns.id")}</TableHead>
                <TableHead>{t("orders.columns.amount")}</TableHead>
                <TableHead>{t("orders.columns.downPayment")}</TableHead>
                <TableHead>{t("orders.columns.poolPortion")}</TableHead>
                <TableHead>{t("orders.columns.tenor")}</TableHead>
                <TableHead>{t("orders.columns.status")}</TableHead>
                <TableHead>{t("orders.columns.createdAt")}</TableHead>
                <TableHead>{t("orders.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => {
                const canFund = isAdmin && trade.status === "PENDING";
                const canAdvance =
                  isAdmin && NEXT_TRADE_STATUS[trade.status] !== undefined;
                const canRepay =
                  user?.role === "USER" &&
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
                    <TableCell>
                      {t("orders.days", {
                        count: Math.round(trade.tenor / 86400),
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge className={TRADE_STATUS_STYLE[trade.status] ?? ""}>
                        {tradeStatusLabel(trade.status)}
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
                          <Link href={`/orders/${trade.tradeId}`}>
                            {t("orders.action.details")}
                          </Link>
                        </Button>
                        {canFund && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onFund(trade)}
                          >
                            {t("orders.action.fund")}
                          </Button>
                        )}
                        {canAdvance && NEXT_TRADE_STATUS[trade.status] && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onAdvance(trade)}
                          >
                            {advanceLabel(trade.status)}
                          </Button>
                        )}
                        {canRepay && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onRepay(trade)}
                          >
                            {t("orders.action.repay")}
                          </Button>
                        )}
                        {canDefault && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onDefault(trade)}
                          >
                            {t("orders.action.default")}
                          </Button>
                        )}
                        {canRelease && (
                          <Button
                            size="sm"
                            disabled={busyId === trade.tradeId}
                            onClick={() => onRelease(trade)}
                          >
                            {t("orders.action.releaseFunds")}
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
