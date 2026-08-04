import { AdminGuard } from "./admin.guard";

function makeContext(sub?: string, role?: string) {
  const request = { user: sub ? { sub, role } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("AdminGuard (trade-service)", () => {
  it("allows ADMIN users", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: "ADMIN" })) } };
    const guard = new AdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext("u1", "ADMIN"))).resolves.toBe(true);
  });

  it("rejects users whose DB role is not ADMIN", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ role: "USER" })) } };
    const guard = new AdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext("u2", "ADMIN"))).rejects.toThrow();
  });

  it("rejects requests without a user", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };
    const guard = new AdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext())).rejects.toThrow();
  });
});
