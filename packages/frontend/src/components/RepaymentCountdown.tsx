"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format";

export function RepaymentCountdown({
  createdAt,
  tenorSeconds,
  status,
}: {
  createdAt: string;
  tenorSeconds: number;
  status: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (status !== "REPAYING") return null;
  if (now === null) {
    return (
      <div className="space-y-1">
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <div className="h-1.5 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const deadline = new Date(createdAt).getTime() + tenorSeconds * 1000;
  const total = tenorSeconds * 1000;
  const diff = deadline - now;
  const elapsedPct = total > 0 ? Math.min(100, Math.max(0, (1 - diff / total) * 100)) : 100;
  const expired = diff <= 0;
  const urgent = !expired && diff < 3 * 86_400_000;
  const overdueDays = Math.floor(Math.abs(diff) / 86_400_000);

  const days = Math.max(0, Math.floor(diff / 86_400_000));
  const hours = Math.max(0, Math.floor((diff % 86_400_000) / 3_600_000));
  const minutes = Math.max(0, Math.floor((diff % 3_600_000) / 60_000));
  const seconds = Math.max(0, Math.floor((diff % 60_000) / 1000));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {expired ? (
          <span className="font-medium text-red-600">
            {t("repayment.expired")}
            {overdueDays > 0 ? t("repayment.overdueDays", { count: overdueDays }) : ""}
          </span>
        ) : (
          <span
            className={`font-medium ${
              urgent ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {urgent && <span className="mr-1.5">{t("repayment.urgent")}</span>}
            <span>
              {t("repayment.remaining", { days, hours, minutes, seconds })}
            </span>
          </span>
        )}
        <span className="text-muted-foreground">
          {t("repayment.deadline", {
            deadline: formatDateTime(new Date(deadline).toISOString()),
          })}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            expired ? "bg-red-500" : urgent ? "bg-orange-500" : "bg-emerald-500"
          }`}
          style={{ width: `${elapsedPct}%` }}
        />
      </div>
    </div>
  );
}
