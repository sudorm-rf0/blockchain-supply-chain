"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import dynamic from "next/dynamic";
import {
  CircleDollarSign,
  Landmark,
  Scale,
  Percent,
} from "lucide-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { OnchainActivity } from "@/components/OnchainActivity";
import { useUserStore } from "@/stores/user-store";
import { useIntervalWhenVisible } from "@/hooks/useIntervalWhenVisible";
import { ClipboardCheck, Upload, Files, ReceiptText, Users, ScrollText, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    loading: () => <div className="skeleton h-80 w-full rounded-lg" />,
  },
);

const LiquidityUtilizationChart = dynamic(
  () => import("@/components/LiquidityUtilizationChart").then((m) => m.LiquidityUtilizationChart),
  {
    ssr: false,
    loading: () => <div className="skeleton h-72 w-full rounded-lg" />,
  },
);

// ==== 分段标识: 页面组件 ====
export default function DashboardPage() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const user = useUserStore((s) => s.user);
  const [overview, setOverview] = useState<PoolOverview | null>(null);
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lpAmount, setLpAmount] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const { t } = useTranslation();

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

  // 性能优化：页面隐藏时暂停轮询，恢复可见立即刷新
  useIntervalWhenVisible(() => {
    void load();
    void refreshIndexer();
  }, 30_000);

  const handleRedeem = async () => {
    if (!connected || !publicKey) {
      toast.error(t("dashboard.connectWalletFirst"));
      return;
    }
    const lpNum = Number(lpAmount);
    if (!Number.isFinite(lpNum) || lpNum <= 0) {
      toast.error(t("dashboard.invalidLpAmount"));
      return;
    }
    const raw = BigInt(Math.round(lpNum * 1_000_000));
    if (raw <= BigInt(0)) {
      toast.error(t("dashboard.invalidLpAmount"));
      return;
    }
    setRedeeming(true);
    try {
      const built = await buildRedeemLp(publicKey.toBase58(), raw.toString(10));
      const transaction = Transaction.from(Buffer.from(built.transaction, "base64"));
      const signature = await sendTransaction(transaction, connection);
      await confirmTransactionWithTimeout(connection, signature, "confirmed");
      const result = await confirmRedeemLp(raw.toString(10), signature);
      toast.success(t("dashboard.redeemExecuted", { status: result.status }));
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("dashboard.redeemFailed"));
    } finally {
      setRedeeming(false);
    }
  };

  const stats = overview
    ? [
        {
          label: t("dashboard.poolSize"),
          value: `$${formatUsdc(overview.totalAssets)}`,
          count: Number(overview.totalAssets) / 1e6,
          accent: "text-sky-600 dark:text-sky-300",
          icon: CircleDollarSign,
        },
        {
          label: t("dashboard.nav"),
          value: `$${formatUsdc(overview.nav)}`,
          count: Number(overview.nav) / 1e6,
          accent: "text-emerald-600 dark:text-emerald-300",
          icon: Landmark,
        },
        {
          label: t("dashboard.downPaymentPoolRatio"),
          value: `${overview.downPaymentSharePct.toFixed(1)}% / ${overview.poolPortionSharePct.toFixed(1)}%`,
          accent: "text-amber-600 dark:text-amber-300",
          icon: Scale,
        },
        {
          label: t("dashboard.apr"),
          value: `${overview.aprPct.toFixed(2)}%`,
          accent: "text-fuchsia-600 dark:text-fuchsia-300",
          icon: Percent,
        },
      ]
    : [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-primary">DFR SUPPLY CHAIN</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{t("dashboard.title")}</h1>
          {user && (
            <Badge
              variant="outline"
              className={
                user.role === "SUPER_ADMIN"
                  ? "mt-1 border-amber-500/40 bg-amber-500/15 text-amber-600"
                  : user.role === "ADMIN"
                    ? "mt-1 border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
                    : "mt-1 border-muted bg-muted text-muted-foreground"
              }
            >
              {user.role === "SUPER_ADMIN"
                ? t("accounts.roleSuperAdmin")
                : user.role === "ADMIN"
                  ? t("accounts.roleAdmin")
                  : t("accounts.roleUser")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {user?.role !== "USER" && (
            <Button variant="outline" asChild>
              <Link href="/trade/new">{t("dashboard.createOrder")}</Link>
            </Button>
          )}
          <WalletConnectButton />
        </div>
      </header>

      <section>
        <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("dashboard.quickActions")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {user?.role === "USER"
            ? [
                { href: "/user/upload", label: t("dashboard.quickUpload"), icon: Upload },
                { href: "/user/files", label: t("dashboard.quickFiles"), icon: Files },
                { href: "/orders", label: t("dashboard.quickOrders"), icon: ReceiptText },
              ].map((a) => (
                <QuickAction key={a.href} href={a.href} label={a.label} icon={a.icon} />
              ))
            : [
                { href: "/admin/files?status=PENDING", label: t("dashboard.quickReview"), icon: ClipboardCheck },
                ...(user?.role === "SUPER_ADMIN"
                  ? [{ href: "/admin/accounts", label: t("dashboard.quickAccounts"), icon: Users }]
                  : []),
                { href: "/admin/audit", label: t("dashboard.quickAudit"), icon: ScrollText },
                { href: "/admin/supply-chain", label: t("dashboard.quickSupply"), icon: Boxes },
              ].map((a) => (
                <QuickAction key={a.href} href={a.href} label={a.label} icon={a.icon} />
              ))}
        </div>
      </section>

      <OnchainActivity />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.redeemLpTitle")}</CardTitle>
          <CardDescription>{t("dashboard.redeemLpDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="lp-amount" className="text-xs text-muted-foreground">
                {t("dashboard.lpAmount")}
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
              {redeeming ? t("dashboard.redeeming") : t("dashboard.redeemOnChain")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {t("dashboard.indexer")}{" "}
          {indexer ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t("dashboard.indexerSynced")}{" "}
              {indexer.lastPoolSnapshotAt ? formatDateTime(indexer.lastPoolSnapshotAt) : t("dashboard.indexerNoSnapshot")}
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">{t("dashboard.indexerUnreachable")}</span>
          )}
        </p>
        {indexer && indexer.queue.failed > 0 && (
          <p className="text-amber-600 dark:text-amber-400">{t("dashboard.failedJobs", { count: indexer.queue.failed })}</p>
        )}
      </div>

      {overview?.paused && (
        <div className="rounded-lg border border-red-500/60 bg-red-50 p-4 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {t("dashboard.pausedBanner")}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="skeleton h-28 rounded-lg border" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 underline">
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {overview && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat, i) => (
              <Card
                key={stat.label}
                className={`group relative animate-fade-in-up overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:border-[#00E676]/40 hover:shadow-[0_12px_28px_-16px_rgba(0,230,118,0.55)] animate-delay-${i + 1}`}
              >
                <div className="sheen" aria-hidden="true" />
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardDescription>{stat.label}</CardDescription>
                  <stat.icon
                    className={`h-4 w-4 transition-transform duration-300 group-hover:scale-110 ${stat.accent}`}
                  />
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-semibold ${stat.accent}`}>
                    {stat.count != null ? (
                      <AnimatedNumber value={stat.count} prefix="$" />
                    ) : (
                      stat.value
                    )}
                  </p>
                </CardContent>
              </Card>
            ))}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("dashboard.governanceParams")}</CardTitle>
              <CardDescription>{t("dashboard.governanceParamsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.feeApy")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {(Number(overview.feeApyBps) / 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.overdueFeeApy")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {(Number(overview.overdueFeeApyBps) / 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.firstLossReserve")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    ${formatUsdc(overview.firstLossReserve)}
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.escrowFunded")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    ${formatUsdc(overview.escrowFunded)}
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.shareSplit")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {(Number(overview.lpShareBps) / 100).toFixed(0)}% /{" "}
                    {(Number(overview.platformShareBps) / 100).toFixed(0)}% /{" "}
                    {(Number(overview.rebateShareBps) / 100).toFixed(0)}%
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.redemptionPrice")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    ${formatUsdc(overview.redemptionPrice)}
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03] sm:col-span-2">
                  <p className="text-xs text-muted-foreground">{t("dashboard.pendingAdmin")}</p>
                  <p className="mt-1 break-all font-mono text-xs">
                    {overview.pendingAdmin ?? t("dashboard.noPendingAdmin")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="mb-4 flex items-center justify-between">
                <CardTitle className="text-base">{t("dashboard.assetTrend")}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.utilization", { value: ((overview.utilizationBps / 10_000) * 100).toFixed(1) })}
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
                <CardTitle className="text-base">{t("dashboard.liquidityUtilization")}</CardTitle>
                <p className="text-xs text-muted-foreground">{t("dashboard.idleLiquidityFormula")}</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.idleLiquidity")}</p>
                  <p className="mt-1 text-xl font-semibold text-[#00E676]">
                    $
                    {formatUsdc(
                      (BigInt(overview.totalAssets) - BigInt(overview.activeCapital)).toString(10),
                    )}
                  </p>
                </div>
                <div className="rounded-md border p-3 transition-colors duration-200 hover:border-[#00E676]/30 hover:bg-primary/[0.03]">
                  <p className="text-xs text-muted-foreground">{t("dashboard.currentUtilization")}</p>
                  <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-300">
                    {((overview.utilizationBps / 10_000) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              <LiquidityUtilizationChart trend={overview.trend} />
            </CardContent>
          </Card>

          <section className="grid gap-4 sm:grid-cols-3">
            <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00E676]/40 hover:shadow-[0_10px_24px_-16px_rgba(0,230,118,0.5)]">
              <CardHeader>
                <CardDescription>{t("dashboard.activeDeals")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">{overview.activeDeals}</p>
              </CardContent>
            </Card>
            <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00E676]/40 hover:shadow-[0_10px_24px_-16px_rgba(0,230,118,0.5)]">
              <CardHeader>
                <CardDescription>{t("dashboard.settledDeals")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold text-emerald-600 dark:text-emerald-300">
                  {overview.settledDeals}
                </p>
              </CardContent>
            </Card>
            <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00E676]/40 hover:shadow-[0_10px_24px_-16px_rgba(0,230,118,0.5)]">
              <CardHeader>
                <CardDescription>{t("dashboard.defaultedDeals")}</CardDescription>
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

function QuickAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Upload;
}) {
  return (
    <Link
      href={href}
      className="group sheen relative flex items-center gap-3 overflow-hidden rounded-md border border-border bg-background p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00E676]/60 hover:bg-primary/5 hover:shadow-[0_4px_16px_-8px_rgba(0,230,118,0.4)]"
    >
      <Icon className="h-4 w-4 shrink-0 text-[#00E676] transition-transform duration-200 group-hover:scale-110" />
      <span className="truncate text-sm">{label}</span>
    </Link>
  );
}
