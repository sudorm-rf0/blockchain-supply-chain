"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { LOCALE_NAMES, type SupportedLocale } from "@/locales";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      className={cn(
        "flex items-center gap-1 border border-border font-mono text-xs",
        className,
      )}
    >
      <Languages className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l as SupportedLocale)}
          className={cn(
            "px-2 py-1.5 transition-colors",
            locale === l
              ? "bg-primary/15 text-[#00E676]"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {LOCALE_NAMES[l as SupportedLocale]}
        </button>
      ))}
    </div>
  );
}
