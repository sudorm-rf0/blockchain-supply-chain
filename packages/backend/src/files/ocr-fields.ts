/**
 * OCR 关键信息提取 + 自动校验（基于 tesseract 输出文本）
 */

export interface KeyField {
  value: string;
  numeric?: string | null;
}

export interface KeyFields {
  invoiceNumber?: KeyField;
  amount?: KeyField;
  date?: KeyField;
  contractNo?: KeyField;
  seller?: KeyField;
  buyer?: KeyField;
}

export interface ValidationItem {
  name: string;
  passed: boolean;
  detail: string;
}

/** 移除中文间的空格（tesseract 会把中文逐字空格化），便于正则匹配 */
export function normalizeOcrText(text: string): string {
  return text.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1");
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
  两: 2,
};
const CN_UNITS: Record<string, number> = {
  拾: 10, 佰: 100, 仟: 1000, 万: 10_000, 亿: 100_000_000,
};

/** 中文大写金额 → 数字（支持到亿，忽略角分细节按整数万圆处理） */
export function cnAmountToNumber(cn: string): number | null {
  let total = 0;
  let section = 0;
  let digit = 0;
  let hasUnit = false;
  for (const ch of cn) {
    if (ch === "圆" || ch === "元" || ch === "整" || ch === "正") {
      if (digit > 0) section += digit;
      if (section > 0 || hasUnit) total += section;
      section = 0;
      digit = 0;
      hasUnit = false;
      if (ch === "元" || ch === "圆") {
        // 到“元”为止，后续角分暂不处理
        break;
      }
      continue;
    }
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
      hasUnit = false;
      continue;
    }
    if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      if (digit === 0 && ch === "拾") digit = 1; // 拾 => 一十
      if (unit === 10_000 || unit === 100_000_000) {
        section = (section + digit) * unit;
        total += section;
        section = 0;
      } else {
        section += (digit || 1) * unit;
      }
      digit = 0;
      hasUnit = true;
      continue;
    }
    if (ch === "角" || ch === "分") {
      digit = 0;
      continue;
    }
  }
  if (digit > 0) section += digit;
  total += section;
  return total > 0 ? total : null;
}

export function extractKeyFields(raw: string): KeyFields {
  const text = normalizeOcrText(raw);
  const fields: KeyFields = {};

  const inv = text.match(/发票号码?[:：\s]*([A-Za-z0-9\-]{6,30})/);
  if (inv) fields.invoiceNumber = { value: inv[1] };

  const date = text.match(/(\d{4})[年\-/.年](\d{1,2})[月\-/.月](\d{1,2})日?/);
  if (date) fields.date = { value: `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}` };

  const contract = text.match(/合同(?:编号|号)?[:：\s]*([A-Za-z0-9\-]{3,40})/);
  if (contract) fields.contractNo = { value: contract[1] };

  const seller = text.match(/(?:销售方|销方|卖方)[:：\s]*([\u4e00-\u9fffA-Za-z0-9（）()·]{2,40}?)(?:备注|电话|地址|开户|税号|$)/);
  if (seller) fields.seller = { value: seller[1] };

  const buyer = text.match(/(?:购买方|购方|买方)[:：\s]*([\u4e00-\u9fffA-Za-z0-9（）()·]{2,40}?)(?:备注|电话|地址|开户|税号|$)/);
  if (buyer) fields.buyer = { value: buyer[1] };

  // 金额：先数字，再大写
  const numAmt = text.match(/(?:金额|价税合计|小写金额|合计)[:：\s]*[¥￥]?\s*([0-9][0-9,]*\.?\d{0,2})/);
  const capAmt = text.match(/人民币?([零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+)/);
  if (numAmt || capAmt) {
    fields.amount = {
      value: capAmt ? capAmt[1] : (numAmt ? numAmt[1] : ""),
      numeric: numAmt ? numAmt[1].replace(/,/g, "") : null,
    };
  }
  return fields;
}

export function validateFields(fields: KeyFields): ValidationItem[] {
  const out: ValidationItem[] = [];
  if (fields.invoiceNumber) {
    out.push({
      name: "invoice_number_format",
      passed: /^[A-Za-z0-9]{6,20}$/.test(fields.invoiceNumber.value),
      detail: "发票号码格式正常",
    });
  }
  if (fields.date) {
    const [y, m, d] = fields.date.value.split("-").map(Number);
    const valid = y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
    out.push({
      name: "date_valid",
      passed: valid,
      detail: valid ? "开票日期格式有效" : "开票日期疑似无效",
    });
  }
  if (fields.amount) {
    const numeric = fields.amount.numeric;
    const capNum = fields.amount.value.includes("圆") || fields.amount.value.includes("元")
      ? cnAmountToNumber(fields.amount.value)
      : null;
    if (numeric && capNum !== null) {
      const diff = Math.abs(Number(numeric) - capNum);
      const ok = diff < 0.01;
      out.push({
        name: "amount_crosscheck",
        passed: ok,
        detail: ok
          ? `大写金额与数字金额一致（${fields.amount.value} = ${numeric}）`
          : `大写金额与数字金额不一致（大写 ${fields.amount.value} ≈ ${capNum}，数字 ${numeric}）`,
      });
    } else if (numeric) {
      out.push({
        name: "amount_parsed",
        passed: true,
        detail: `识别到金额 ${numeric}`,
      });
    }
  }
  return out;
}
