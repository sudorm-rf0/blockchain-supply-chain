"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const SECTIONS = Array.from({ length: 29 }, (_, i) => `s${i + 1}`);

export default function TermsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {t("back")}
        </Button>
      </div>
      <h1 className="text-2xl font-bold">{t("legal.terms.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("legal.terms.updated")}</p>
      <div className="space-y-4 text-sm leading-7">
        {SECTIONS.map((k) => (
          <section key={k}>
            <h2 className="text-base font-semibold">{t(`legal.terms.${k}.title`)}</h2>
            <p>{t(`legal.terms.${k}.body`)}</p>
          </section>
        ))}
      </div>
      <p>
        <Link href="/privacy" className="text-primary underline">
          {t("legal.viewPrivacy")}
        </Link>
      </p>
    </main>
  );
}
