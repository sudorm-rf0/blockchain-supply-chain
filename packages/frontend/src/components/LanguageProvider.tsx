"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import i18n, {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from "@/lib/i18n";
import { BACKEND_URL } from "@/lib/env";

const STORAGE_KEY = "dfr-locale";

interface LanguageContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
});

export function useLanguage() {
  return useContext(LanguageContext);
}

/** 根据浏览器请求的 IP 国家码（后端 cf-ipcountry 推断）返回建议语言 */
async function detectLocale(): Promise<SupportedLocale> {
  try {
    // 修复：语言检测接口在主后端，须用绝对地址（相对路径会打到前端导致 404）
    const res = await fetch(`${BACKEND_URL}/api/meta/locale`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { locale?: string };
      if (isSupportedLocale(data.locale)) return data.locale;
    }
  } catch {
    // 网络异常时保持默认语言
  }
  return DEFAULT_LOCALE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    let active = true;
    void (async () => {
      let next: SupportedLocale | null = null;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isSupportedLocale(saved)) next = saved;
      } catch {
        // localStorage 不可用时忽略
      }
      if (!next) next = await detectLocale();
      if (!active) return;
      setLocaleState(next);
      void i18n.changeLanguage(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    void i18n.changeLanguage(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}
