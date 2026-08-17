"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAllTrades, formatUsdc, type TradeRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { TRADE_STATUS_STYLE } from "@/lib/status";

export default function AdminTradesPage() {
  const { t } = useTranslation();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const statusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      PENDING: t("trades.status.pending"),
      FUNDED: t("trades.status.funded"),
      IN_TRANSIT: t("trades.status.inTransit"),
      CUSTOMS_CLEAR: t("trades.status.customsClear"),
      DELIVERED: t("trades.status.delivered"),
      REPAYING: t("trades.status.repaying"),
      SETTLED: t("trades.status.settled"),
      DEFAULTED: t("trades.status.defaulted"),
    };
    return labels[status] ?? status;
  };

  const load = useCallback(async () => {
    try {
      setTrades(await fetchAllTrades());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("trades.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("trades.title")}</h1>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("refresh")}
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("trades.loading")}</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("trades.empty")}</p>
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {trades.map((trade) => (
            <div key={trade.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {trade.name || trade.tradeId}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {trade.tradeId}
                  </p>
                </div>
                <Badge className={TRADE_STATUS_STYLE[trade.status] ?? ""}>
                  {statusLabel(trade.status)}
                </Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("trades.colAmount")}</dt>
                <dd className="font-medium">{formatUsdc(trade.amount)} USDC</dd>
                <dt className="text-muted-foreground">{t("trades.colBuyer")}</dt>
                <dd className="font-mono">{trade.buyerWallet.slice(0, 12)}...</dd>
                <dt className="text-muted-foreground">{t("trades.colSeller")}</dt>
                <dd className="font-mono">{trade.sellerWallet.slice(0, 12)}...</dd>
                <dt className="text-muted-foreground">{t("trades.colCreatedAt")}</dt>
                <dd>{formatDateTime(trade.createdAt)}</dd>
              </dl>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("trades.colId")}</TableHead>
                <TableHead>{t("trades.colName")}</TableHead>
                <TableHead>{t("trades.colAmount")}</TableHead>
                <TableHead>{t("trades.colStatus")}</TableHead>
                <TableHead>{t("trades.colBuyer")}</TableHead>
                <TableHead>{t("trades.colSeller")}</TableHead>
                <TableHead>{t("trades.colCreatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-mono text-xs">
                    {trade.tradeId}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-sm">
                    {trade.name || "-"}
                  </TableCell>
                  <TableCell>{formatUsdc(trade.amount)} USDC</TableCell>
                  <TableCell>
                    <Badge className={TRADE_STATUS_STYLE[trade.status] ?? ""}>
                      {statusLabel(trade.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {trade.buyerWallet.slice(0, 12)}...
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {trade.sellerWallet.slice(0, 12)}...
                  </TableCell>
                  <TableCell>{formatDateTime(trade.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  );
}
