"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Button } from "@/components/ui/button";
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
    loading: () => (
      <div className="h-80 w-full animate-pulse rounded-lg bg-zinc-900/60" />
    ),
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

  useEffect(() => {
    void (async () => {
      try {
        setIndexer(await fetchIndexerStatus());
      } catch {
        setIndexer(null);
      }
    })();
  }, []);

  const handleRedeem = async () => {
    if (!connected || !publicKey) {
      toast.error("请先连接钱包");
      return;
    }
    const raw = BigInt(Math.round(Number(lpAmount) * 1_000_000));
    if (!Number.isFinite(Number(lpAmount)) || raw <= BigInt(0)) {
      toast.error("请输入有效的 LP 数量");
      return;
    }
    setRedeeming(true);
    try {
      const built = await buildRedeemLp(publicKey.toBase58(), raw.toString(10));
      const transaction = Transaction.from(
        Buffer.from(built.transaction, "base64"),
      );
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
          accent: "text-sky-300",
        },
        {
          label: "Current NAV",
          value: `$${formatUsdc(overview.nav)}`,
          accent: "text-emerald-300",
        },
        {
          label: "30 / 70 Position",
          value: `${overview.downPaymentSharePct.toFixed(1)}% / ${overview.poolPortionSharePct.toFixed(1)}%`,
          accent: "text-amber-300",
        },
        {
          label: "Realtime APR",
          value: `${overview.aprPct.toFixed(2)}%`,
          accent: "text-fuchsia-300",
        },
      ]
    : [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-400">SOLANA SUPPLY CHAIN</p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-100">Pool Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex gap-2 text-sm">
            <Link
              href="/trade/new"
              className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300"
            >
              New Trade
            </Link>
          </nav>
          <WalletConnectButton />
        </div>
      </header>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">LP 链上赎回</h2>
        <p className="mt-1 text-xs text-zinc-500">
          按当前 NAV 换算，单次赎回不超过闲置资金 50%
        </p>
        <div className="mt-3 flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="text-xs text-zinc-400">LP 数量</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={lpAmount}
              onChange={(event) => setLpAmount(event.target.value)}
              placeholder="1000"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </label>
          <Button
            type="button"
            disabled={redeeming || !connected}
            onClick={() => void handleRedeem()}
          >
            {redeeming ? "赎回中..." : "链上赎回"}
          </Button>
        </div>
      </section>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <p>
          Indexer{" "}
          {indexer ? (
            <span className="text-emerald-400">
              synced · last snapshot{" "}
              {indexer.lastPoolSnapshotAt
                ? formatDateTime(indexer.lastPoolSnapshotAt)
                : "n/a"}
            </span>
          ) : (
            <span className="text-red-400">unreachable</span>
          )}
        </p>
        {indexer && indexer.queue.failed > 0 && (
          <p className="text-amber-400">{indexer.queue.failed} failed jobs</p>
        )}
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/40 p-4 text-sm text-red-200">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 underline"
          >
            Retry
          </button>
        </div>
      )}

      {overview && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <p className="text-sm text-zinc-400">{stat.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${stat.accent}`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">
                Asset Trend
              </h2>
              <p className="text-xs text-zinc-500">
                Utilization {((overview.utilizationBps / 10_000) * 100).toFixed(1)}%
              </p>
            </div>
            <AssetTrendChart trend={overview.trend} />
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-sm text-zinc-400">Active Deals</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">
                {overview.activeDeals}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-sm text-zinc-400">Settled</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">
                {overview.settledDeals}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-sm text-zinc-400">Defaulted</p>
              <p className="mt-1 text-xl font-semibold text-red-300">
                {overview.defaultedDeals}
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
