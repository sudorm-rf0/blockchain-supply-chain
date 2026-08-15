"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BarChart3, Copy, Download, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [copied, setCopied] = useState(false);

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

  const trend = stats?.trend?.slice(-14) ?? [];
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-[#00E676]" />
                  {t("inviteStats.trend")}
                </CardTitle>
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
                  <span className="text-muted-foreground/70">{t("inviteStats.last14Days")}</span>
                </div>
              </CardContent>
            </Card>
          </div>

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
    </div>
  );
}
