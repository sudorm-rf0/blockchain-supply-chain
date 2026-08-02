"use client";

import { useEffect, useState } from "react";

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
  const diff = deadline - now;
  if (diff <= 0) {
    return <span className="text-xs font-medium text-red-600">已到期</span>;
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return (
    <span className="text-xs font-medium text-orange-600">
      剩余 {days}天 {hours}时 {minutes}分 {seconds}秒
    </span>
  );
}
