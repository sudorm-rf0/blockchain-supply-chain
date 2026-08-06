"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildRedeemLp,
  confirmRedeemLp,
  fetchIndexerStatus,
  PoolOverview,
  fetchPoolOverview,
  formatUsdc,
  type IndexerStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { confirmTransactionWithTimeout } from "@/lib/solana";

const AssetTrendChart = dynamic(
  () => import("@/components/AssetTrendChart").then((m) => m.AssetTrendChart),
  {
    ssr: false,
    loading: () => <div className="h-80 w-full animate-pulse rounded-lg bg-muted" />,
  },
);

const LiquidityUtilizationChart = dynamic(
  () => import("@/components/LiquidityUtilizationChart").then((m) => m.LiquidityUtilizationChart),
  {
    ssr: false,
    loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted" />,
  },
);

// ==== 分段标识: 页面组件 ====
export default function DashboardPage() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [overview, setOverview] = useState<PoolOverview | null>(null);
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lpAmount, setLpAmount] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await fetchPoolOverview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshIndexer = useCallback(async () => {
    try {
      setIndexer(await fetchIndexerStatus());
    } catch {
      setIndexer(null);
    }
  }, []);

  useEffect(() => {
    void refreshIndexer();
  }, [refreshIndexer]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
      void refreshIndexer();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load, refreshIndexer]);

  const handleRedeem = async () => {
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
      return;
    }
    const lpNum = Number(lpAmount);
    if (!Number.isFinite(lpNum) || lpNum <= 0) {
      toast.error("请输入有效的 LP 数量");
      return;
    }
    const raw = BigInt(Math.round(lpNum * 1_000_000));
    if (raw <= BigInt(0)) {
      toast.error("请输入有效的 LP 数量");
      return;
    }
    setRedeeming(true);
    try {
      const built = await buildRedeemLp(publicKey.toBase58(), raw.toString(10));
      const transaction = Transaction.from(Buffer.from(built.transaction, "base64"));
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirmRedeemLp(raw.toString(10), signature);
      toast.success(`LP 赎回已执行：${result.status}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "LP 赎回失败");
    } finally {
      setRedeeming(false);
    }
  };

  const stats = overview
    ? [
        {
          label: "Pool Size",
          value: `$${formatUsdc(overview.totalAssets)}`,
          accent: "text-sky-600 dark:text-sky-300",
        },
        {
          label: "Current NAV",
          value: `$${formatUsdc(overview.nav)}`,
          accent: "text-emerald-600 dark:text-emerald-300",
        },
        {
          label: "30 / 70 Position",
          value: `${overview.downPaymentSharePct.toFixed(1)}% / ${overview.poolPortionSharePct.toFixed(1)}%`,
          accent: "text-amber-600 dark:text-amber-300",
        },
        {
          label: "Realtime APR",
          value: `${overview.aprPct.toFixed(2)}%`,
          accent: "text-fuchsia-600 dark:text-fuchsia-300",
        },
      ]
    : [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-primary">SOLANA SUPPLY CHAIN</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">资金池看板</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/trade/new">创建订单</Link>
          </Button>
          <WalletConnectButton />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LP 链上赎回</CardTitle>
          <CardDescription>按当前 NAV 换算，单次赎回不超过闲置资金 50%</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="lp-amount" className="text-xs text-muted-foreground">
                LP 数量
              </label>
              <Input
                id="lp-amount"
                type="number"
                min="0"
                step="0.01"
                value={lpAmount}
                onChange={(event) => setLpAmount(event.target.value)}
                placeholder="1000"
              />
            </div>
            <Button
              type="button"
              disabled={redeeming || !connected}
              onClick={() => void handleRedeem()}
            >
              {redeeming ? "赎回中..." : "链上赎回"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          Indexer{" "}
          {indexer ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              synced · last snapshot{" "}
              {indexer.lastPoolSnapshotAt ? formatDateTime(indexer.lastPoolSnapshotAt) : "n/a"}
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">unreachable</span>
          )}
        </p>
        {indexer && indexer.queue.failed > 0 && (
          <p className="text-amber-600 dark:text-amber-400">{indexer.queue.failed} failed jobs</p>
        )}
      </div>

      {overview?.paused && (
        <div className="rounded-lg border border-red-500/60 bg-red-50 p-4 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
          资金池已紧急暂停：链上放款/还款/赎回/建单等资金操作已被冻结，请管理员确认后再恢复。
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {overview && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardHeader>
                  <CardDescription>{stat.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-semibold ${stat.accent}`}>{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <Card>
            <CardHeader>
              <div className="mb-4 flex items-center justify-between">
                <CardTitle className="text-base">资产趋势</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Utilization {((overview.utilizationBps / 10_000) * 100).toFixed(1)}%
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <AssetTrendChart trend={overview.trend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">流动性 / 利用率</CardTitle>
                <p className="text-xs text-muted-foreground">闲置流动性 = 总资产 - 活跃资本</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">闲置流动性</p>
                  <p className="mt-1 text-xl font-semibold text-violet-600 dark:text-violet-300">
                    $
                    {formatUsdc(
                      (BigInt(overview.totalAssets) - BigInt(overview.activeCapital)).toString(10),
                    )}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">当前利用率</p>
                  <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-300">
                    {((overview.utilizationBps / 10_000) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              <LiquidityUtilizationChart trend={overview.trend} />
            </CardContent>
          </Card>

          <section className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Active Deals</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">{overview.activeDeals}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Settled</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold text-emerald-600 dark:text-emerald-300">
                  {overview.settledDeals}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Defaulted</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold text-red-600 dark:text-red-300">
                  {overview.defaultedDeals}
                </p>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
