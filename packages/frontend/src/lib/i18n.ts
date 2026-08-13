"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "@/locales";

export type SupportedLocale = "zh-CN" | "en" | "zh-TW";
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["zh-CN", "en", "zh-TW"];

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function isSupportedLocale(v: string | null | undefined): v is SupportedLocale {
  return !!v && (SUPPORTED_LOCALES as string[]).includes(v);
}

export default i18n;
