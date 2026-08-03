"use client";

import { useEffect, useState } from "react";
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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (status !== "REPAYING") return null;

  const deadline = new Date(createdAt).getTime() + tenorSeconds * 1000;
  const total = tenorSeconds * 1000;
  const diff = deadline - now;
  const elapsedPct = total > 0 ? Math.min(100, Math.max(0, (1 - diff / total) * 100)) : 100;
  const expired = diff <= 0;

  const days = Math.max(0, Math.floor(diff / 86_400_000));
  const hours = Math.max(0, Math.floor((diff % 86_400_000) / 3_600_000));
  const minutes = Math.max(0, Math.floor((diff % 3_600_000) / 60_000));
  const seconds = Math.max(0, Math.floor((diff % 60_000) / 1000));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {expired ? (
          <span className="font-medium text-red-600">还款已到期</span>
        ) : (
          <span className="font-medium text-orange-600">
            剩余 {days}天 {hours}时 {minutes}分 {seconds}秒
          </span>
        )}
        <span className="text-muted-foreground">
          截止 {formatDateTime(new Date(deadline).toISOString())}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            expired ? "bg-red-500" : "bg-orange-500"
          }`}
          style={{ width: `${elapsedPct}%` }}
        />
      </div>
    </div>
  );
}
