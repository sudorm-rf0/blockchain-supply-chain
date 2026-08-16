"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];

export default function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">{t("legal.privacy.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("legal.privacy.updated")}</p>
      <div className="space-y-4 text-sm leading-7">
        {SECTIONS.map((k) => (
          <section key={k}>
            <h2 className="text-base font-semibold">{t(`legal.privacy.${k}.title`)}</h2>
            <p>{t(`legal.privacy.${k}.body`)}</p>
          </section>
        ))}
      </div>
      <p>
        <Link href="/terms" className="text-primary underline">
          {t("legal.viewTerms")}
        </Link>
      </p>
    </main>
  );
}
