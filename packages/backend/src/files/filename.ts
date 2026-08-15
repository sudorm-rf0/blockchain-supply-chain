/**
 * multer/busboy 默认用 latin1 解码 multipart 文件名，导致中文文件名被双重编码：
 * 原始 UTF-8 字节被当作 latin1 字符，存成 "æµè¯..." 形式的乱码。
 * 这里把 latin1 串还原回 UTF-8；已是正确 UTF-8（含非 latin1 字符）的原样保留。
 */
export function decodeFilename(name: string): string {
  if (!name) return name;
  // 已含非 latin1 字符（如正常中文）→ 原样保留
  if (/[^\u0000-\u00FF]/.test(name)) return name;
  try {
    const recovered = Buffer.from(name, "latin1").toString("utf8");
    // 还原结果是合法 UTF-8（无替换符）且确实不同 → 采用还原值
    if (!recovered.includes("\uFFFD") && recovered !== name) return recovered;
  } catch {
    // 解析失败原样返回
  }
  return name;
}
