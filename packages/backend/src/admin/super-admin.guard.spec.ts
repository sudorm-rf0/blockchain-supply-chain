import { SuperAdminGuard } from "@supply-chain/common";

function makeContext(sub?: string) {
  const request = { user: sub ? { sub } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("SuperAdminGuard", () => {
  it("allows SUPER_ADMIN users", async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ role: "SUPER_ADMIN" })) },
    };
    const guard = new SuperAdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext("u1"))).resolves.toBe(true);
  });

  it("rejects ADMIN users", async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ role: "ADMIN" })) },
    };
    const guard = new SuperAdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext("u1"))).rejects.toThrow();
  });

  it("rejects USER users", async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ role: "USER" })) },
    };
    const guard = new SuperAdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext("u1"))).rejects.toThrow();
  });

  it("rejects requests without a user", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };
    const guard = new SuperAdminGuard(prisma as never);
    await expect(guard.canActivate(makeContext())).rejects.toThrow();
  });
});
