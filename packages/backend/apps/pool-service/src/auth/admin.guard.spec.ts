import { ForbiddenException } from "@nestjs/common";
import { AdminGuard } from "./admin.guard";

function makeContext(role?: string) {
  const request = { user: role ? { role } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("AdminGuard (pool-service)", () => {
  it("allows ADMIN users", () => {
    const guard = new AdminGuard();
    expect(guard.canActivate(makeContext("ADMIN"))).toBe(true);
  });

  it("rejects USER users", () => {
    const guard = new AdminGuard();
    expect(() => guard.canActivate(makeContext("USER"))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects requests without a user", () => {
    const guard = new AdminGuard();
    expect(() => guard.canActivate(makeContext())).toThrow(ForbiddenException);
  });
});
