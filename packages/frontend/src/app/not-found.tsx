"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <p className="text-xs font-semibold text-primary">DFR SUPPLY CHAIN</p>
      <h1 className="text-2xl font-bold text-foreground">{t("notFound.title")}</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {t("notFound.description")}
      </p>
      <Button asChild>
        <Link href="/dashboard">{t("notFound.backHome")}</Link>
      </Button>
    </div>
  );
}
