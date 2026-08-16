"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchAiStats, type AiStats } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const ACTION_LABELS: Record<string, string> = {
  AI_ASSISTANT_CHAT: "aiStats.action.chat",
  FILE_AI_REVIEWED: "aiStats.action.review",
  FILE_AI_EXTRACTED: "aiStats.action.extract",
  FILE_AI_SUMMARIZED: "aiStats.action.summarize",
  FILE_AI_CHAT: "aiStats.action.fileChat",
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-2xl font-bold text-[#00E676]">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminAiStatsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AiStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStats(await fetchAiStats());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("aiStats.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDay = Math.max(1, ...(stats?.byDay.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("aiStats.title")}</h1>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("aiStats.refresh")}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("aiStats.loading")}</p>
      ) : stats ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={t("aiStats.last24h")} value={stats.last24h} />
            <StatCard label={t("aiStats.last7d")} value={stats.last7d} />
            <StatCard label={t("aiStats.total30d")} value={stats.total30d} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">{t("aiStats.byAction")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {Object.entries(stats.byAction).length === 0 ? (
                  <p className="text-muted-foreground">{t("aiStats.empty")}</p>
                ) : (
                  Object.entries(stats.byAction)
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, count]) => (
                      <div key={action} className="flex justify-between border-b border-border/50 pb-1 last:border-0">
                        <span className="text-muted-foreground">
                          {t(ACTION_LABELS[action] ?? action, { defaultValue: action })}
                        </span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">{t("aiStats.byModel")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {Object.entries(stats.byModel).length === 0 ? (
                  <p className="text-muted-foreground">{t("aiStats.empty")}</p>
                ) : (
                  Object.entries(stats.byModel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([model, count]) => (
                      <div key={model} className="flex justify-between border-b border-border/50 pb-1 last:border-0">
                        <span className="font-mono text-xs text-muted-foreground">{model}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{t("aiStats.byDay")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <div className="flex items-end gap-1">
                {stats.byDay.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-sm bg-[#00E676]/40"
                      style={{ height: `${Math.max(2, (d.count / maxDay) * 80)}px` }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {d.date.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{t("aiStats.recent")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("aiStats.empty")}</p>
              ) : (
                stats.recent.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 border-b border-border/50 pb-1.5 text-sm last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">
                        {r.question || t("aiStats.noQuestion")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.actorEmail ?? "-"} · {r.model} · {formatDateTime(r.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(ACTION_LABELS[r.action] ?? r.action, { defaultValue: r.action })}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
