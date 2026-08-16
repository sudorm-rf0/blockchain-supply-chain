"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchNotificationBanner, type BannerNotification } from "@/lib/notifications-api";
import { formatDateTime } from "@/lib/format";

const DISMISS_KEY = "dfr:banner-dismissed";

function isDismissed(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === id;
  } catch {
    return false;
  }
}

/** 全站通知横幅：展示最新未读广播通知，可关闭（关闭后本次通知不再展示） */
export function NotificationBanner() {
  const { t } = useTranslation();
  const [banner, setBanner] = useState<BannerNotification | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchNotificationBanner();
        if (!cancelled) {
          const n = res.notification;
          setBanner(n);
          if (n) setDismissed(isDismissed(n.id) ? n.id : null);
        }
      } catch {
        /* ignore */
      }
    };
    void load();
    // 60s 轮询，发现新广播时展示
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!banner || dismissed === banner.id) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, banner.id);
    } catch {
      /* ignore */
    }
    setDismissed(banner.id);
  };

  return (
    <div className="flex items-start gap-3 border-b border-[#00E676]/30 bg-[#00E676]/10 px-4 py-2.5 sm:px-6">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#00E676]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{banner.title}</span>
          {banner.creatorName && (
            <span className="text-xs text-muted-foreground">
              {t("panels.notifications.bcBy")}: {banner.creatorName}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground">{formatDateTime(banner.createdAt)}</span>
        </div>
        {banner.body && <p className="mt-0.5 text-sm text-muted-foreground">{banner.body}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/notifications">{t("panels.notifications.viewAll")}</Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={handleDismiss} aria-label="dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
