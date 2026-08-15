import { decodeFilename } from "./filename";

describe("decodeFilename", () => {
  it("还原 latin1 双重编码的中文文件名", () => {
    // 模拟 busboy latin1 解码：正确 UTF-8 字节按 latin1 读成字符串
    const original = "测试中文文件名.pdf";
    const mangled = Buffer.from(original, "utf8").toString("latin1");
    expect(mangled).not.toBe(original);
    expect(decodeFilename(mangled)).toBe(original);
  });

  it("已正确的中文文件名保持不变", () => {
    expect(decodeFilename("测试中文文件名.pdf")).toBe("测试中文文件名.pdf");
  });

  it("ASCII 文件名保持不变", () => {
    expect(decodeFilename("invoice.pdf")).toBe("invoice.pdf");
  });
});
