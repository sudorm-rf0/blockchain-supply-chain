import i18n from "@/lib/i18n";

const REGION_NAMES: Record<
  string,
  { zhCN: string; en: string; zhTW: string }
> = {
  CN: { zhCN: "中国大陆", en: "Mainland China", zhTW: "中國大陸" },
  TW: { zhCN: "中国台湾", en: "Taiwan", zhTW: "臺灣" },
  HK: { zhCN: "中国香港", en: "Hong Kong", zhTW: "香港" },
  MO: { zhCN: "中国澳门", en: "Macau", zhTW: "澳門" },
  SG: { zhCN: "新加坡", en: "Singapore", zhTW: "新加坡" },
  MY: { zhCN: "马来西亚", en: "Malaysia", zhTW: "馬來西亞" },
  US: { zhCN: "美国", en: "United States", zhTW: "美國" },
  GB: { zhCN: "英国", en: "United Kingdom", zhTW: "英國" },
  JP: { zhCN: "日本", en: "Japan", zhTW: "日本" },
  KR: { zhCN: "韩国", en: "South Korea", zhTW: "韓國" },
  AU: { zhCN: "澳大利亚", en: "Australia", zhTW: "澳洲" },
  DE: { zhCN: "德国", en: "Germany", zhTW: "德國" },
  FR: { zhCN: "法国", en: "France", zhTW: "法國" },
  CA: { zhCN: "加拿大", en: "Canada", zhTW: "加拿大" },
  IN: { zhCN: "印度", en: "India", zhTW: "印度" },
  TH: { zhCN: "泰国", en: "Thailand", zhTW: "泰國" },
  VN: { zhCN: "越南", en: "Vietnam", zhTW: "越南" },
};

/** 按当前界面语言返回区域名称；未知区域回退为原始国家码 */
export function regionLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const lang = i18n.language ?? "zh-CN";
  const entry = REGION_NAMES[code.toUpperCase()];
  if (!entry) return code.toUpperCase();
  if (lang.startsWith("zh-TW")) return entry.zhTW;
  if (lang.startsWith("en")) return entry.en;
  return entry.zhCN;
}
