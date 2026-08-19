"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, CheckCheck, Inbox, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatDateTime } from "@/lib/format";
import { useUserStore } from "@/stores/user-store";
import { createBroadcastNotification } from "@/lib/api";
import { toast } from "sonner";
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
  const user = useUserStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [bcTitle, setBcTitle] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [sending, setSending] = useState(false);

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

  const handleBroadcast = async () => {
    if (!bcTitle.trim()) {
      toast.error(t("panels.notifications.bcTitleRequired"));
      return;
    }
    setSending(true);
    try {
      await createBroadcastNotification({ title: bcTitle.trim(), body: bcBody.trim() || undefined });
      toast.success(t("panels.notifications.bcSent"));
      setBroadcastOpen(false);
      setBcTitle("");
      setBcBody("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("panels.notifications.bcFailed"));
    } finally {
      setSending(false);
    }
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" onClick={() => setBroadcastOpen(true)}>
              <Megaphone className="mr-1.5 h-3.5 w-3.5" />
              {t("panels.notifications.broadcast")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleAllRead()} disabled={unread === 0}>
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            {t("panels.notifications.markAllRead")}
          </Button>
        </div>
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
                    {n.broadcast && (
                      <Badge className="bg-[#00E676]/15 text-[#00E676]">{t("panels.notifications.bcBadge")}</Badge>
                    )}
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-[#00E676]" />}
                  </div>
                  {n.broadcast && n.creatorName && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("panels.notifications.bcBy")}: {n.creatorName}
                    </p>
                  )}
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

      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-[#00E676]" />
              {t("panels.notifications.broadcast")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-title" className="text-xs text-muted-foreground">
                {t("panels.notifications.bcTitle")}
              </Label>
              <Input
                id="bc-title"
                value={bcTitle}
                maxLength={200}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder={t("panels.notifications.bcTitlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-body" className="text-xs text-muted-foreground">
                {t("panels.notifications.bcBody")}
              </Label>
              <Textarea
                id="bc-body"
                value={bcBody}
                rows={5}
                maxLength={2000}
                onChange={(e) => setBcBody(e.target.value)}
                placeholder={t("panels.notifications.bcBodyPlaceholder")}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("panels.notifications.bcHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)}>
              {t("panels.notifications.cancel") ?? "取消"}
            </Button>
            <Button onClick={() => void handleBroadcast()} disabled={sending || !bcTitle.trim()}>
              {sending ? t("panels.reports.loading") : t("panels.notifications.bcSend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
