"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
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

  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">{t("error.title")}</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {error.message || t("error.unknown")}
      </p>
      <Button onClick={reset}>{t("common.retry")}</Button>
    </div>
  );
}
