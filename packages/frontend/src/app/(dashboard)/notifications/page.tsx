"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, CheckCheck, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationRecord,
} from "@/lib/notifications-api";

const TYPE_BADGE: Record<string, string> = {
  FILE_REVIEWED: "border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]",
  TRADE_STATUS: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  WITHDRAWAL_STATUS: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  SYSTEM: "border-muted bg-muted text-muted-foreground",
};

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(1, 50);
      setItems(data.items);
      setUnread(data.unread);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRead = async (id: string) => {
    await markNotificationRead(id).catch(() => undefined);
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
  };

  const handleAllRead = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
          <BellRing className="h-5 w-5 text-[#00E676]" />
          {t("panels.notifications.title")}
          {unread > 0 && (
            <Badge className="ml-2 bg-[#00E676] text-black">{unread}</Badge>
          )}
        </h1>
        <Button variant="outline" size="sm" onClick={() => void handleAllRead()} disabled={unread === 0}>
          <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
          {t("panels.notifications.markAllRead")}
        </Button>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("panels.reports.loading")}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <Inbox className="h-10 w-10" />
            <p className="text-sm">{t("panels.notifications.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void handleRead(n.id)}
              className={`block w-full rounded-md border p-4 text-left transition-colors ${
                n.readAt
                  ? "border-border/60 bg-background"
                  : "border-[#00E676]/30 bg-[#00E676]/5 hover:bg-[#00E676]/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={TYPE_BADGE[n.type] ?? TYPE_BADGE.SYSTEM}>
                      {t(`panels.notifications.types.${n.type}`) ?? n.type}
                    </Badge>
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-[#00E676]" />}
                  </div>
                  {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                </div>
                <time className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </time>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
