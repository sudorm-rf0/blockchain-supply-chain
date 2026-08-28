/**
 * multer/busboy 默认用 latin1 解码 multipart 文件名，导致中文文件名被双重编码：
 * 原始 UTF-8 字节被当作 latin1 字符，存成 "æµè¯..." 形式的乱码。
 * 这里把 latin1 串还原回 UTF-8；已是正确 UTF-8（含非 latin1 字符）的原样保留。
 */
export function decodeFilename(name: string): string {
  if (!name) return name;
  let result = name;
  // 已含非 latin1 字符（如正常中文）→ 原样保留；否则尝试 latin1→UTF-8 还原
  if (!/[^\u0000-\u00FF]/.test(name)) {
    try {
      const recovered = Buffer.from(name, "latin1").toString("utf8");
      if (!recovered.includes("\uFFFD") && recovered !== name) result = recovered;
    } catch {
      // 解析失败保留原值
    }
  }
  return sanitizeFilename(result);
}

/**
 * L1：文件名安全清洗——移除路径分隔符、`..`、控制字符与换行，
 * 防止路径穿越与 Content-Disposition 响应头注入；限制长度。
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/\u0000-\u001F\u007F]/g, "")
    .replace(/\.\.+/g, ".")
    .trim()
    .slice(0, 255);
  return cleaned || "unnamed";
}
