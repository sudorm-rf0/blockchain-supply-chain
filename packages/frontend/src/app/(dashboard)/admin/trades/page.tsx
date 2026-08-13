"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
      <h1 className="text-lg font-semibold">{t("trades.title")}</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("trades.loading")}</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("trades.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("trades.colId")}</TableHead>
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
      )}
    </div>
  );
}
