import { FilesAnalysisService } from "./files-analysis.service";

describe("FilesAnalysisService OCR clean", () => {
  // @ts-expect-error access private method for unit test
  const clean = (t: string) => FilesAnalysisService.prototype.cleanOcrText.call({ logger: console }, t);

  it("strips trailing noise symbols from lines", () => {
    expect(clean("DRAGON ORCHARD LIMITED +\n47/F KOWLOON BAY |")).toBe("DRAGON ORCHARD LIMITED\n47/F KOWLOON BAY");
  });

  it("drops pure-symbol lines", () => {
    expect(clean("abc\n---\n=~=\ndef")).toBe("abc\ndef");
  });

  it("converts full-width digits/letters to half-width", () => {
    expect(clean("发票Ｎｏ：２０２５０７")).toBe("发票No：202507");
  });

  it("collapses blank lines", () => {
    expect(clean("a\n\n\n\nb")).toBe("a\nb");
  });

  it("keeps normal text intact", () => {
    const text = "这是正常的中文文本，包含金额 123.45 美元。";
    expect(clean(text)).toBe(text);
  });
});
