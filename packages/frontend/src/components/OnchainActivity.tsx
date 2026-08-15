"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, ExternalLink, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

interface ActivityItem {
  type: "FILE_ATTEST" | "TRADE" | "PRODUCT";
  id: string;
  title: string;
  timestamp: string;
  txSignature?: string;
  solscanUrl?: string;
}

export function OnchainActivity({ limit = 8 }: { limit?: number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/public/activity?limit=${limit}`);
        const data = (await res.json()) as { ok: boolean; items?: ActivityItem[] };
        if (!cancelled && data.ok) setItems(data.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  const typeLabel = (type: string) =>
    t(`onchain.activity.${type}`) ?? type;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-[#00E676]" />
          {t("onchain.activity.title")}
        </CardTitle>
        <Link href="/verify" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {t("onchain.verify.entry")} →
        </Link>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <p className="text-sm text-muted-foreground">{t("onchain.trace.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("onchain.activity.empty")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-center gap-3 py-2.5">
                <span className="w-2 shrink-0">
                  <span className="block h-2 w-2 rounded-full bg-[#00E676]/70" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="mr-2 text-xs text-muted-foreground">{typeLabel(item.type)}</span>
                    {item.title}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{formatDateTime(item.timestamp)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                    <Link href={`/trace/${item.id}`}>
                      <Route className="mr-1 h-3 w-3" />
                      {t("onchain.activity.viewTrace")}
                    </Link>
                  </Button>
                  {item.solscanUrl && (
                    <a
                      href={item.solscanUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent"
                      title={t("onchain.verify.solscan")}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
