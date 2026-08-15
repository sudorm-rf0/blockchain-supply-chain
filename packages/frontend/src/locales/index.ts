import zhCNCommon from "./common/zh-CN";
import zhCNAuth from "./auth/zh-CN";
import zhCNShell from "./shell/zh-CN";
import zhCNDashboard from "./dashboard/zh-CN";
import zhCNAdmin from "./admin/zh-CN";
import zhCNAdmin2 from "./admin2/zh-CN";
import zhCNOrders from "./orders/zh-CN";
import zhCNOnchain from "./onchain/zh-CN";
import enCommon from "./common/en";
import enAuth from "./auth/en";
import enShell from "./shell/en";
import enDashboard from "./dashboard/en";
import enAdmin from "./admin/en";
import enAdmin2 from "./admin2/en";
import enOrders from "./orders/en";
import enOnchain from "./onchain/en";
import zhTWCommon from "./common/zh-TW";
import zhTWAuth from "./auth/zh-TW";
import zhTWShell from "./shell/zh-TW";
import zhTWDashboard from "./dashboard/zh-TW";
import zhTWAdmin from "./admin/zh-TW";
import zhTWAdmin2 from "./admin2/zh-TW";
import zhTWOrders from "./orders/zh-TW";
import zhTWOnchain from "./onchain/zh-TW";

export type SupportedLocale = "zh-CN" | "en" | "zh-TW";
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  "zh-CN": "简体中文",
  en: "English",
  "zh-TW": "繁體中文",
};

type LocaleDict = Record<string, string | Record<string, string>>;

const translation = (
  common: LocaleDict,
  auth: LocaleDict,
  shell: LocaleDict,
  dashboard: LocaleDict,
  admin: LocaleDict,
  admin2: LocaleDict,
  orders: LocaleDict,
  onchain: LocaleDict,
) => ({ ...common, ...auth, ...shell, ...dashboard, ...admin, ...admin2, ...orders, ...onchain });

export const resources = {
  "zh-CN": {
    translation: translation(zhCNCommon, zhCNAuth, zhCNShell, zhCNDashboard, zhCNAdmin, zhCNAdmin2, zhCNOrders, zhCNOnchain),
  },
  en: {
    translation: translation(enCommon, enAuth, enShell, enDashboard, enAdmin, enAdmin2, enOrders, enOnchain),
  },
  "zh-TW": {
    translation: translation(zhTWCommon, zhTWAuth, zhTWShell, zhTWDashboard, zhTWAdmin, zhTWAdmin2, zhTWOrders, zhTWOnchain),
  },
} as const;
