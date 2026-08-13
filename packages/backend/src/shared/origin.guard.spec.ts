import { ForbiddenException } from "@nestjs/common";
import { OriginGuard } from "./origin.guard";

function context(
  method: string,
  headers: Record<string, string | undefined>,
  path = "/api/anything",
  ip = "203.0.113.9",
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers,
        path,
        ip,
        protocol: "http",
      }),
    }),
  } as never;
}

describe("OriginGuard", () => {
  const guard = new OriginGuard();

  it("blocks cross-origin mutating requests", () => {
    expect(() =>
      guard.canActivate(
        context("POST", { origin: "https://evil.example" }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows mutating requests from localhost origins", () => {
    expect(
      guard.canActivate(
        context("POST", { origin: "http://localhost:3100" }),
      ),
    ).toBe(true);
  });

  it("blocks mutating requests without an origin header (M1)", () => {
    expect(() => guard.canActivate(context("POST", {}))).toThrow(
      ForbiddenException,
    );
  });

  it("exempts CSP report endpoint from origin requirement (M1)", () => {
    expect(
      guard.canActivate(context("POST", {}, "/api/csp-report")),
    ).toBe(true);
  });

  it("allows loopback clients without origin (scripts/CI/e2e, M1)", () => {
    expect(
      guard.canActivate(context("POST", {}, "/api/anything", "127.0.0.1")),
    ).toBe(true);
  });

  it("allows read requests from any origin", () => {
    expect(
      guard.canActivate(
        context("GET", { origin: "https://evil.example" }),
      ),
    ).toBe(true);
  });
});
