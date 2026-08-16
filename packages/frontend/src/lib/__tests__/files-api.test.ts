import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL } from "../env";
import { getFiles, uploadFile, reviewFile } from "../files-api";

function mockFetchOk() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body && !(init.body instanceof FormData)
          ? JSON.parse(String(init.body))
          : init?.body instanceof FormData
            ? "FORM_DATA"
            : undefined,
      });
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("files-api 契约", () => {
  it("getFiles 携带 page/limit/status/tradeId 查询参数", async () => {
    const { calls } = mockFetchOk();
    await getFiles({ page: 2, limit: 10, status: "PENDING", tradeId: "t1" });
    expect(calls[0].url).toBe(
      `${BACKEND_URL}/api/files?page=2&limit=10&status=PENDING&tradeId=t1`,
    );
  });

  it("getFiles ALL 状态不带 status 参数（与后端一致）", async () => {
    const { calls } = mockFetchOk();
    await getFiles({ page: 1, limit: 20, status: "ALL" });
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/files?page=1&limit=20&status=ALL`);
  });

  it("uploadFile POST /api/files 使用 FormData", async () => {
    const { calls } = mockFetchOk();
    const fd = new FormData();
    fd.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    await uploadFile(fd);
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/files`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBe("FORM_DATA");
  });

  it("reviewFile PATCH /api/files/:id 携带 status+confirm", async () => {
    const { calls } = mockFetchOk();
    await reviewFile("f1", { status: "APPROVED", remark: "ok" });
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/files/f1`);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({
      status: "APPROVED",
      remark: "ok",
      confirm: true,
    });
  });
});
