"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Globe, Monitor, ShieldAlert, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUserStore } from "@/stores/user-store";
import {
  fetchOwnerSummary,
  fetchOwnerVisits,
  fetchWebmasterInfo,
  type VisitItem,
  type VisitSummary,
  type WebmasterInfo,
} from "@/lib/owner-api";

type Tab = "summary" | "visits" | "webmaster";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

export default function OwnerPanelPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [visits, setVisits] = useState<VisitItem[] | null>(null);
  const [webmaster, setWebmaster] = useState<WebmasterInfo | null>(null);
  const [page, setPage] = useState(1);
  const [ipFilter, setIpFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 仅超级管理员可见；其余角色一律离开（隐形入口）
  useEffect(() => {
    if (user && user.role !== "SUPER_ADMIN") {
      router.replace("/admin/files");
    }
  }, [user, router]);

  useEffect(() => {
    if (!user || user.role !== "SUPER_ADMIN") return;
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [s, w] = await Promise.all([fetchOwnerSummary(), fetchWebmasterInfo()]);
        if (!active) return;
        setSummary(s);
        setWebmaster(w);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "SUPER_ADMIN") return;
    let active = true;
    void (async () => {
      try {
        const res = await fetchOwnerVisits({ page, limit: 50, ip: ipFilter || undefined });
        if (!active) return;
        setVisits(res.items);
        setTotal(res.total);
      } catch {
        if (active) setVisits([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, page, ipFilter]);

  const rangeCards = useMemo(() => {
    if (!summary) return [];
    const order: Array<"today" | "24h" | "7d"> = ["today", "24h", "7d"];
    return order.map((k) => ({
      label: summary.ranges[k].label,
      visits: summary.ranges[k].visits,
      uniqueIps: summary.ranges[k].uniqueIps,
      loggedIn: summary.ranges[k].loggedInVisits,
    }));
  }, [summary]);

  if (!user || user.role !== "SUPER_ADMIN") return null;

  const tabBtn = (v: Tab, label: string, Icon: typeof Globe) => (
    <button
      type="button"
      onClick={() => setTab(v)}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${
        tab === v ? "bg-primary/15 text-[#00E676]" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("back")}
        </Button>
        <h1 className="mt-2 text-2xl font-bold">站长面板（隐形 · 仅所有者）</h1>
        <p className="text-sm text-muted-foreground">
          浏览记录 / 访客 IP / 服务器与站点信息 · 数据保留 30 天
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {tabBtn("summary", "访问总览", Globe)}
        {tabBtn("visits", "浏览记录与 IP", Monitor)}
        {tabBtn("webmaster", "站长信息", ShieldAlert)}
      </div>

      {tab === "summary" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {rangeCards.map((c) => (
              <Card key={c.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{c.label}访问</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{c.visits}</p>
                  <p className="text-xs text-muted-foreground">
                    独立 IP {c.uniqueIps} · 登录访问 {c.loggedIn}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Globe className="h-4 w-4 text-[#00E676]" /> 热门页面（7 天）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(summary?.topPages ?? []).slice(0, 10).map((p) => (
                  <div key={p.path} className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span className="truncate">{p.path}</span>
                    <Badge variant="outline">{p.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Monitor className="h-4 w-4 text-[#00E676]" /> 热门 IP（7 天）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(summary?.topIps ?? []).slice(0, 10).map((p) => (
                  <div key={p.ip} className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span>{p.ip}</span>
                    <Badge variant="outline">{p.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <ShieldAlert className="h-4 w-4 text-red-500" /> 错误（7 天）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(summary?.errors ?? []).map((e) => (
                  <div key={e.statusCode} className="flex items-center justify-between font-mono text-xs">
                    <span className={e.statusCode >= 500 ? "text-red-500" : "text-amber-600"}>
                      HTTP {e.statusCode}
                    </span>
                    <Badge variant="outline">{e.count}</Badge>
                  </div>
                ))}
                {!summary?.errors?.length && (
                  <p className="text-xs text-muted-foreground">近 7 天无错误</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Timer className="h-4 w-4 text-amber-500" /> 慢接口（7 天，按平均耗时）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(summary?.slow ?? []).slice(0, 8).map((s) => (
                  <div key={s.path} className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span className="truncate">{s.path}</span>
                    <span className="shrink-0 text-muted-foreground">{s.avgMs}ms ×{s.count}</span>
                  </div>
                ))}
                {!summary?.slow?.length && (
                  <p className="text-xs text-muted-foreground">暂无数据</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "visits" && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">浏览记录与访客 IP（共 {total} 条）</CardTitle>
              <input
                value={ipFilter}
                onChange={(e) => {
                  setIpFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="按 IP 筛选"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && !visits && <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>}
            {!loading && visits && visits.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无浏览记录</p>
            )}
            {visits && visits.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <table className="min-w-[720px] w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left">
                        <th className="px-2 py-1.5 font-medium">时间</th>
                        <th className="px-2 py-1.5 font-medium">IP</th>
                        <th className="px-2 py-1.5 font-medium">方法</th>
                        <th className="px-2 py-1.5 font-medium">路径</th>
                        <th className="px-2 py-1.5 font-medium">状态</th>
                        <th className="px-2 py-1.5 font-medium">耗时</th>
                        <th className="px-2 py-1.5 font-medium">UA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visits.map((v) => (
                        <tr key={v.id} className="border-b border-border/50">
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{formatTime(v.createdAt)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{v.ip ?? "-"}</td>
                          <td className="px-2 py-1.5">{v.method}</td>
                          <td className="max-w-[220px] truncate px-2 py-1.5 font-mono">{v.path}</td>
                          <td className="px-2 py-1.5">
                            <span className={v.statusCode >= 500 ? "text-red-500" : v.statusCode >= 400 ? "text-amber-600" : "text-emerald-600"}>
                              {v.statusCode}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{v.durationMs}ms</td>
                          <td className="max-w-[160px] truncate px-2 py-1.5 text-muted-foreground">{v.userAgent ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <span className="text-xs text-muted-foreground">第 {page} 页</span>
                  <Button variant="outline" size="sm" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "webmaster" && webmaster && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Monitor className="h-4 w-4 text-[#00E676]" /> 服务器
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 font-mono text-xs">
              <Row k="主机名" v={webmaster.server.hostname} />
              <Row k="运行时长" v={webmaster.server.uptime} />
              <Row k="平台" v={webmaster.server.platform} />
              <Row k="Node" v={webmaster.server.node} />
              <Row k="CPU 核心" v={String(webmaster.server.cpus)} />
              <Row k="负载" v={webmaster.server.loadavg.map((n) => n.toFixed(2)).join(" / ")} />
              <Row
                k="内存"
                v={`${webmaster.server.memoryMb.used} / ${webmaster.server.memoryMb.total} MB`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <ShieldAlert className="h-4 w-4 text-[#00E676]" /> 站点
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 font-mono text-xs">
              <Row k="用户总数" v={String(webmaster.site.users)} />
              <Row k="文件总数" v={String(webmaster.site.files)} />
              <Row k="待审核文件" v={String(webmaster.site.pendingFiles)} />
              <Row k="订单总数" v={String(webmaster.site.deals)} />
              <Row k="融资申请" v={String(webmaster.site.financing)} />
              <Row k="24h 审计操作" v={String(webmaster.site.audits24h)} />
              <Row k="24h 错误请求" v={String(webmaster.site.errors24h)} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-1">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
