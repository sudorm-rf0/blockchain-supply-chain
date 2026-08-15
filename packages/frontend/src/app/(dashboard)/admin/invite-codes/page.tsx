"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BarChart3, Copy, Download, Plus, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchInviteCodes,
  fetchInviteStats,
  generateInviteCodes,
  fetchInviteCodesExport,
  type InviteCodeRecord,
  type InviteStats,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const ROLE_ORDER = ["USER", "ADMIN", "SUPER_ADMIN"] as const;

export default function InviteCodesPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [items, setItems] = useState<InviteCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"used" | "unused">("used");
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [copied, setCopied] = useState(false);

  // 批量生成邀请码
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCount, setInviteCount] = useState("10");
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [generatedCopied, setGeneratedCopied] = useState(false);

  const handleGenerateInvites = async () => {
    const n = Number(inviteCount);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      toast.error(t("accounts.generateInviteCount"));
      return;
    }
    setGenerating(true);
    try {
      const res = await generateInviteCodes(n);
      setGeneratedCodes(res.codes);
      setGeneratedCopied(false);
      toast.success(t("accounts.generatedCount", { count: res.count }));
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("accounts.generateInviteCount"));
    } finally {
      setGenerating(false);
    }
  };

  const copyGenerated = async () => {
    if (generatedCodes.length === 0) return;
    try {
      await navigator.clipboard.writeText(generatedCodes.join("\n"));
      setGeneratedCopied(true);
      toast.success(t("accounts.copied"));
    } catch {
      toast.error(t("accounts.copied"));
    }
  };

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        fetchInviteStats(),
        fetchInviteCodes(),
      ]);
      setStats(s);
      setItems(list.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inviteStats.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyUnused = async () => {
    const codes = items.filter((i) => !i.usedAt).map((i) => i.code);
    if (codes.length === 0) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      toast.success(t("inviteStats.copied"));
    } catch {
      toast.error(t("inviteStats.copyFailed"));
    }
  };

  const exportList = async () => {
    try {
      const text = await fetchInviteCodesExport();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "invite-codes.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inviteStats.loadFailed"));
    }
  };

  const roleLabel = (role: string) =>
    role === "SUPER_ADMIN"
      ? t("accounts.roleSuperAdmin")
      : role === "ADMIN"
        ? t("accounts.roleAdmin")
        : role === "USER"
          ? t("accounts.roleUser")
          : role;

  const trendDays = Number(range);
  const isoWeekKey = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - day + 3);
    const firstThursday = new Date(t.getFullYear(), 0, 4);
    const week =
      1 +
      Math.round(
        ((t.getTime() - firstThursday.getTime()) / 86_400_000 -
          3 +
          ((firstThursday.getDay() + 6) % 7)) /
          7,
      );
    return `${t.getFullYear()}-W${String(week).padStart(2, "0")}`;
  };
  let trend: Array<{ date: string; generated: number; used: number }> = [];
  if (stats) {
    if (granularity === "day") {
      trend = stats.trend.slice(-trendDays);
    } else {
      const map = new Map<string, { generated: number; used: number }>();
      for (const d of stats.trend) {
        const key =
          granularity === "week" ? isoWeekKey(d.date) : d.date.slice(0, 7);
        const cur = map.get(key) ?? { generated: 0, used: 0 };
        cur.generated += d.generated;
        cur.used += d.used;
        map.set(key, cur);
      }
      trend = [...map.entries()].map(([date, v]) => ({ date, ...v }));
    }
  }
  const maxTrend = Math.max(1, ...trend.map((d) => Math.max(d.generated, d.used)));

  const usedItems = items.filter((i) => i.usedAt);
  const unusedItems = items.filter((i) => !i.usedAt);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
          <Ticket className="h-5 w-5 text-[#00E676]" />
          {t("inviteStats.title")}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInvite(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("accounts.generateInviteCodes")}
          </Button>
          <Button variant="outline" size="sm" onClick={copyUnused}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {copied ? t("inviteStats.copied") : t("inviteStats.copyUnused")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportList}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("inviteStats.export")}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("inviteStats.loading")}</p>
      ) : stats ? (
        <>
          {/* 统计卡 */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("inviteStats.total")}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("inviteStats.used")}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold text-emerald-600">{stats.used}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("inviteStats.unused")}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold text-amber-600">{stats.unused}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("inviteStats.usageRate")}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{stats.usageRate}%</div></CardContent>
            </Card>
          </div>

          {/* 角色分布 + 趋势 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-[#00E676]" />
                  {t("inviteStats.byRole")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ROLE_ORDER.map((role) => (
                  <div key={role} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <span>{roleLabel(role)}</span>
                    <Badge variant="secondary">{stats.byRole[role] ?? 0}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-[#00E676]" />
                  {t("inviteStats.trend")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-md border p-0.5">
                    {(["day", "week", "month"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGranularity(g)}
                        className={`rounded px-2 py-1 text-xs ${granularity === g ? "bg-primary/15 text-[#00E676]" : "text-muted-foreground"}`}
                      >
                        {t(`inviteStats.by${g === "day" ? "Day" : g === "week" ? "Week" : "Month"}`)}
                      </button>
                    ))}
                  </div>
                  {granularity === "day" && (
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                      {(["7", "30", "90"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setRange(d)}
                          className={`rounded px-2 py-1 text-xs ${range === d ? "bg-primary/15 text-[#00E676]" : "text-muted-foreground"}`}
                        >
                          {d}{t("inviteStats.days")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex h-32 items-end gap-1">
                  {trend.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-0.5">
                      <div className="flex w-full flex-col-reverse items-center gap-0.5">
                        <div
                          className="w-full max-w-3 rounded-sm bg-emerald-500/70"
                          style={{ height: `${(d.used / maxTrend) * 100}%`, minHeight: d.used > 0 ? 3 : 1 }}
                          title={`${d.date} used: ${d.used}`}
                        />
                        <div
                          className="w-full max-w-3 rounded-sm bg-primary/30"
                          style={{ height: `${(d.generated / maxTrend) * 100}%`, minHeight: d.generated > 0 ? 3 : 1 }}
                          title={`${d.date} generated: ${d.generated}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/70" />{t("inviteStats.used")}</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-primary/30" />{t("inviteStats.generated")}</span>
                  <span className="text-muted-foreground/70">
                    {granularity === "day"
                      ? t("inviteStats.lastNDays", { n: trendDays })
                      : t("inviteStats.lastNDays", { n: 90 })}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 按管理员统计 */}
          {stats.byCreator.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ticket className="h-4 w-4 text-[#00E676]" />
                  {t("inviteStats.byCreator")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("inviteStats.creator")}</TableHead>
                        <TableHead>{t("inviteStats.generated")}</TableHead>
                        <TableHead>{t("inviteStats.used")}</TableHead>
                        <TableHead>{t("inviteStats.usageRate")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.byCreator.map((c) => (
                        <TableRow key={c.userId}>
                          <TableCell className="text-xs">
                            <span className="font-medium">{c.name ?? "-"}</span>
                            <span className="ml-1 text-muted-foreground">{c.email ?? ""}</span>
                          </TableCell>
                          <TableCell className="text-xs">{c.generated}</TableCell>
                          <TableCell className="text-xs text-emerald-600">{c.used}</TableCell>
                          <TableCell className="text-xs">
                            <span className={c.usageRate > 0 ? "text-emerald-600" : "text-muted-foreground"}>
                              {c.usageRate}%
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 已用 / 未用列表 */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ticket className="h-4 w-4 text-[#00E676]" />
                {tab === "used" ? t("inviteStats.used") : t("inviteStats.unused")}
              </CardTitle>
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                <button type="button" onClick={() => setTab("used")} className={`rounded px-2.5 py-1 text-xs ${tab === "used" ? "bg-primary/15 text-[#00E676]" : "text-muted-foreground"}`}>
                  {t("inviteStats.used")} ({usedItems.length})
                </button>
                <button type="button" onClick={() => setTab("unused")} className={`rounded px-2.5 py-1 text-xs ${tab === "unused" ? "bg-primary/15 text-[#00E676]" : "text-muted-foreground"}`}>
                  {t("inviteStats.unused")} ({unusedItems.length})
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("inviteStats.code")}</TableHead>
                      <TableHead>{t("inviteStats.usedBy")}</TableHead>
                      <TableHead>{t("inviteStats.usedAt")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tab === "used" ? usedItems : unusedItems).map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.code}</TableCell>
                        <TableCell className="text-xs">
                          {tab === "used" ? (
                            <>
                              <span className="font-medium">{i.usedByName ?? "-"}</span>
                              <span className="ml-1 text-muted-foreground">{i.usedByEmail ?? ""}</span>
                              <Badge variant="secondary" className="ml-1.5">{roleLabel(i.usedByRole ?? "")}</Badge>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{t("inviteStats.unused")}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {tab === "used" && i.usedAt ? formatDateTime(i.usedAt) : formatDateTime(i.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(tab === "used" ? usedItems : unusedItems).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                          {t("inviteStats.empty")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* 批量生成邀请码 */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accounts.generateInviteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("accounts.generateInviteCount")}</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={inviteCount}
                onChange={(e) => setInviteCount(e.target.value)}
              />
            </div>
            <Button onClick={handleGenerateInvites} disabled={generating} className="w-full">
              {generating ? t("accounts.generating") : t("accounts.generate")}
            </Button>
            {generatedCodes.length > 0 && (
              <>
                <Textarea
                  readOnly
                  value={generatedCodes.join("\n")}
                  className="h-48 font-mono text-xs"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={copyGenerated}>
                    {generatedCopied ? t("accounts.copied") : t("accounts.copyAll")}
                  </Button>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              {t("accounts.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
