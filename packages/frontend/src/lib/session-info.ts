/** 从 User-Agent 解析设备/浏览器/系统信息（会话管理用） */

export interface SessionDeviceInfo {
  deviceType: "mobile" | "tablet" | "pc" | "unknown";
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string | null | undefined): SessionDeviceInfo {
  const raw = ua ?? "";
  const lower = raw.toLowerCase();

  // 设备类型
  let deviceType: SessionDeviceInfo["deviceType"] = "pc";
  if (/ipad|tablet|kindle|silk/i.test(raw)) deviceType = "tablet";
  else if (/mobi|iphone|android.*mobile|windows phone/i.test(lower)) deviceType = "mobile";

  // 浏览器
  let browser = "unknown";
  if (/edg\//i.test(raw)) browser = "Edge";
  else if (/opr\/|opera/i.test(raw)) browser = "Opera";
  else if (/chrome\//i.test(raw) && !/edg\//i.test(raw)) browser = "Chrome";
  else if (/firefox\//i.test(raw)) browser = "Firefox";
  else if (/safari\//i.test(raw) && !/chrome\//i.test(raw)) browser = "Safari";
  else if (/micromessenger|wechat/i.test(raw)) browser = "WeChat";
  else if (/curl|node|postman/i.test(lower)) browser = "API";

  // 系统
  let os = "unknown";
  if (/windows/i.test(raw)) os = "Windows";
  else if (/iphone|ipad|ios/i.test(raw)) os = "iOS";
  else if (/android/i.test(raw)) os = "Android";
  else if (/mac os x|macintosh/i.test(raw)) os = "macOS";
  else if (/linux/i.test(raw)) os = "Linux";

  return { deviceType, browser, os };
}

/** 国家代码 → 显示名（跟随界面语言，由调用方传 t 映射；这里返回代码，前端字典翻译） */
export const COUNTRY_NAMES: Record<string, string> = {
  CN: "CN·中国",
  HK: "HK·中国香港",
  MO: "MO·中国澳门",
  TW: "TW·中国台湾",
  US: "US·美国",
  SG: "SG·新加坡",
  JP: "JP·日本",
  KR: "KR·韩国",
  GB: "GB·英国",
  DE: "DE·德国",
  FR: "FR·法国",
  NL: "NL·荷兰",
  AU: "AU·澳大利亚",
  CA: "CA·加拿大",
  IN: "IN·印度",
  VN: "VN·越南",
  TH: "TH·泰国",
  MY: "MY·马来西亚",
  ID: "ID·印度尼西亚",
  PH: "PH·菲律宾",
  AE: "AE·阿联酋",
  RU: "RU·俄罗斯",
};
