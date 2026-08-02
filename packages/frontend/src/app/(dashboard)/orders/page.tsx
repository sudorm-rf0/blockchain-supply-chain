"use client";

import { useCallback, useEffect, useState } from "react";
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
import { fetchMyTrades, formatUsdc, type TradeRecord } from "@/lib/api";

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

export default function OrdersPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">我的订单</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无订单</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单 ID</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>首付</TableHead>
                <TableHead>垫付</TableHead>
                <TableHead>账期</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-mono text-xs">
                    {trade.tradeId}
                  </TableCell>
                  <TableCell>{formatUsdc(trade.amount)} USDC</TableCell>
                  <TableCell>{formatUsdc(trade.downPayment)}</TableCell>
                  <TableCell>{formatUsdc(trade.poolPortion)}</TableCell>
                  <TableCell>{trade.tenor} 天</TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLE[trade.status] ?? ""}>
                      {trade.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(trade.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
