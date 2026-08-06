import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserStore } from "@/stores/user-store";
import { formatUsdc, requestWithRetry } from "../http";

describe("formatUsdc", () => {
  it("formats zero and simple lamport values", () => {
    expect(formatUsdc("0")).toBe("0.00");
    expect(formatUsdc(0)).toBe("0.00");
    expect(formatUsdc("1000000")).toBe("1.00");
    expect(formatUsdc("1234567")).toBe("1.23");
    expect(formatUsdc(1000000)).toBe("1.00");
  });

  it("groups thousands without precision loss", () => {
    expect(formatUsdc("123456789000000")).toBe("123,456,789.00");
    // 超过 Number.MAX_SAFE_INTEGER 的 lamports 也不丢精度
    expect(formatUsdc("9007199254740993000000")).toBe("9,007,199,254,740,993.00");
  });

  it("accepts bigint input", () => {
    expect(formatUsdc(2_500_000n)).toBe("2.50");
  });

  it("falls back to float formatting for non-integer input", () => {
    expect(formatUsdc("1.5")).toBe("1.50");
    expect(formatUsdc(0.5)).toBe("0.50");
  });

  it("never throws on invalid input", () => {
    expect(formatUsdc("abc")).toBe("0.00");
    expect(formatUsdc("")).toBe("0.00");
    expect(formatUsdc(NaN)).toBe("0.00");
    expect(formatUsdc(Infinity)).toBe("0.00");
  });
});

describe("requestWithRetry", () => {
  const setAuthSpy = vi.spyOn(useUserStore.getState(), "setAuth");
  const logoutSpy = vi.spyOn(useUserStore.getState(), "logout");

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    useUserStore.setState({ user: null, hydrated: true });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    // http.ts 的 refreshPromise 清理有 300ms 延迟，等它归零避免跨测试串状态。
    await new Promise((resolve) => setTimeout(resolve, 320));
  });

  it("refreshes session on 401 and retries the original request", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user: { id: "u1", role: "USER" }, mustChangePassword: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = await requestWithRetry(
      "http://localhost:3001/api/data",
      { method: "GET" },
      {},
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(setAuthSpy).toHaveBeenCalled();
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it("force-logouts only when refresh definitively rejects the token", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      requestWithRetry("http://localhost:3001/api/data", { method: "GET" }, {}),
    ).rejects.toThrow("登录已过期，请重新登录");
    expect(logoutSpy).toHaveBeenCalled();
  });

  it("does not logout when refresh fails due to network errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      requestWithRetry("http://localhost:3001/api/data", { method: "GET" }, {}),
    ).rejects.toThrow("网络连接失败");
    expect(logoutSpy).not.toHaveBeenCalled();
  });
});
