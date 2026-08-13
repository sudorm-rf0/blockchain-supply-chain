import { Controller, Get, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";

type SupportedLocale = "zh-CN" | "en" | "zh-TW";

/** IP 国家码 → 建议语言（简中 / 繁中 / 英文） */
const COUNTRY_LOCALE: Record<string, SupportedLocale> = {
  CN: "zh-CN",
  TW: "zh-TW",
  HK: "zh-TW",
  MO: "zh-TW",
  // 中文常用地区默认简体
  SG: "zh-CN",
  MY: "zh-CN",
};

function localeFromAcceptLanguage(header: string | undefined): SupportedLocale | null {
  if (!header) return null;
  if (/zh-TW|zh-Hant|zh-HK|zh-MO/i.test(header)) return "zh-TW";
  if (/^zh/i.test(header)) return "zh-CN";
  if (/^en/i.test(header)) return "en";
  return null;
}

@SkipThrottle()
@Controller("api/meta")
export class MetaController {
  @Get("locale")
  getLocale(@Req() req: Request): { locale: SupportedLocale } {
    const country =
      typeof req.headers["cf-ipcountry"] === "string"
        ? req.headers["cf-ipcountry"].toUpperCase()
        : undefined;
    if (country && COUNTRY_LOCALE[country]) {
      return { locale: COUNTRY_LOCALE[country] };
    }
    const fromAccept = localeFromAcceptLanguage(
      typeof req.headers["accept-language"] === "string"
        ? req.headers["accept-language"]
        : undefined,
    );
    if (fromAccept) return { locale: fromAccept };
    // 已知国家码但无中文区 → 默认英文；无国家码（内网/测试）→ 简体中文
    if (country) return { locale: "en" };
    return { locale: "zh-CN" };
  }
}
