import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuditLogs, exportAuditLogs } from "../admin-api";

function mockFetchOk() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "{}",
        blob: async () => new Blob(["csv"]),
      } as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("admin-api 契约", () => {
  it("fetchAuditLogs 携带筛选参数（邮箱/关键字/时间）", async () => {
    const { calls } = mockFetchOk();
    await fetchAuditLogs({
      page: 1,
      limit: 20,
      actorEmail: "admin@x.io",
      keyword: "AUTH_LOGIN",
      from: "2026-01-01",
      to: "2026-02-01",
      action: "AUTH_LOGIN",
    });
    expect(calls[0].url).toContain("/api/admin/audit-logs?");
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("actorEmail")).toBe("admin@x.io");
    expect(u.searchParams.get("keyword")).toBe("AUTH_LOGIN");
    expect(u.searchParams.get("from")).toBe("2026-01-01");
    expect(u.searchParams.get("to")).toBe("2026-02-01");
    expect(u.searchParams.get("action")).toBe("AUTH_LOGIN");
  });

  it("exportAuditLogs 请求导出端点并返回 Blob", async () => {
    const { calls } = mockFetchOk();
    const blob = await exportAuditLogs({ action: "AUTH_LOGIN" });
    expect(blob).toBeInstanceOf(Blob);
    expect(calls[0].url).toContain("/api/admin/audit-logs/export");
    expect(calls[0].url).toContain("action=AUTH_LOGIN");
  });
});
