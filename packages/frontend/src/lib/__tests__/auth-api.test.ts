import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL } from "../env";
import { login, changeEmail, fetchSessions, revokeOtherSessions } from "../auth-api";

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
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("auth-api 契约", () => {
  it("login POST /api/auth/login 携带邮箱/密码/验证码/turnstile", async () => {
    const { calls } = mockFetchOk();
    await login("a@b.com", "secret123", "123456", "654321", "cf-token");
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/auth/login`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({
      email: "a@b.com",
      password: "secret123",
      totpCode: "123456",
      emailOtpCode: "654321",
      turnstileToken: "cf-token",
    });
  });

  it("changeEmail 携带新旧邮箱双验证码（防劫持契约）", async () => {
    const { calls } = mockFetchOk();
    await changeEmail(
      "new@b.com",
      "111111",
      "cf-token",
      undefined,
      "222222",
    );
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/auth/change-email`);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.newEmail).toBe("new@b.com");
    expect(body.emailCode).toBe("111111");
    expect(body.currentEmailCode).toBe("222222");
  });

  it("fetchSessions GET /api/auth/sessions", async () => {
    const { calls } = mockFetchOk();
    await fetchSessions();
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/auth/sessions`);
    expect(calls[0].method).toBe("GET");
  });

  it("revokeOtherSessions POST /api/auth/sessions/revoke-others", async () => {
    const { calls } = mockFetchOk();
    await revokeOtherSessions();
    expect(calls[0].url).toBe(`${BACKEND_URL}/api/auth/sessions/revoke-others`);
    expect(calls[0].method).toBe("POST");
  });
});
