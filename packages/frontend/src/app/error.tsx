"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">页面出错了</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {error.message || "发生未知错误，请重试。"}
      </p>
      <Button onClick={reset}>重试</Button>
    </div>
  );
}
