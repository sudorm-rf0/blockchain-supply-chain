"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RepaymentCountdown } from "@/components/RepaymentCountdown";
import {
  fetchAllTrades,
  fetchMyTrades,
  formatUsdc,
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

export default function TradeDetailPage() {
  const params = useParams<{ tradeId: string }>();
  const user = useUserStore((state) => state.user);
  const [trade, setTrade] = useState<TradeRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list =
        user?.role === "ADMIN"
          ? await fetchAllTrades()
          : await fetchMyTrades();
      setTrade(
        list.find((item) => item.tradeId === params.tradeId) ?? null,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, [params.tradeId, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const rows: Array<[string, string]> = [
    ["订单 ID", trade.tradeId],
    ["金额", `${formatUsdc(trade.amount)} USDC`],
    ["30% 首付", `${formatUsdc(trade.downPayment)} USDC`],
    ["70% 垫付", `${formatUsdc(trade.poolPortion)} USDC`],
    ["账期", `${trade.tenor / 86400} 天`],
    ["买方", trade.buyerWallet],
    ["卖方", trade.sellerWallet],
    ["创建时间", formatDateTime(trade.createdAt)],
    ["交易签名", trade.txSignature ?? "未上链"],
    ["物流哈希", trade.logisticsHash ?? "-"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">订单详情</h1>
        <Button variant="outline" asChild>
          <Link href="/orders">返回列表</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="font-mono text-base">{trade.tradeId}</span>
            <Badge className={STATUS_STYLE[trade.status] ?? ""}>
              {trade.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trade.status === "REPAYING" && (
            <p className="rounded-md bg-orange-50 p-3 text-sm dark:bg-orange-950/30">
              <RepaymentCountdown
                createdAt={trade.createdAt}
                tenorSeconds={trade.tenor}
                status={trade.status}
              />
            </p>
          )}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
