import { describe, expect, it } from "vitest";
import { formatDateTime } from "../format";

describe("formatDateTime", () => {
  it("formats a Date to zh-CN locale string", () => {
    const date = new Date("2026-08-06T12:34:56+08:00");
    const out = formatDateTime(date);
    expect(typeof out).toBe("string");
    expect(out).toContain("2026");
    expect(out).toContain("8");
  });

  it("accepts an ISO string input", () => {
    const out = formatDateTime("2026-08-06T12:34:56+08:00");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
