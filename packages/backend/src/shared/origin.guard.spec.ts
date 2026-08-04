import { ForbiddenException } from "@nestjs/common";
import { OriginGuard } from "./origin.guard";

function context(method: string, headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        headers,
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

  it("allows mutating requests without an origin header", () => {
    expect(guard.canActivate(context("POST", {}))).toBe(true);
  });

  it("allows read requests from any origin", () => {
    expect(
      guard.canActivate(
        context("GET", { origin: "https://evil.example" }),
      ),
    ).toBe(true);
  });
});
