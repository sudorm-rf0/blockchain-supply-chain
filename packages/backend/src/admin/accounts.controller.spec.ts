import { NotFoundException } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: "u1", ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: "u1", ...data })),
    },
    ...overrides,
  };
}
function makeController(prisma: any) {
  return new AccountsController(prisma as never, { record: jest.fn() } as never);
}

describe("AccountsController 隐藏账号（超管也不可见）", () => {
  it("列表查询强制 hidden: false（隐藏账号不进列表与总数）", async () => {
    const prisma = makePrisma();
    const ctrl = makeController(prisma);
    await ctrl.list("1", "20", undefined, undefined);
    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.hidden).toBe(false);
    const countWhere = (prisma.user.count as jest.Mock).mock.calls[0][0].where;
    expect(countWhere.hidden).toBe(false);
  });

  it("搜索/角色筛选时仍保持 hidden: false", async () => {
    const prisma = makePrisma();
    const ctrl = makeController(prisma);
    await ctrl.list("1", "20", "admin", "SUPER_ADMIN");
    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.hidden).toBe(false);
    expect(where.role).toBe("SUPER_ADMIN");
    expect(where.OR).toBeDefined();
  });

  it("详情接口对隐藏账号返回 404（不可见）", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "hidden-1",
          hidden: true,
          email: "ops@internal",
          name: "Ops",
          role: "SUPER_ADMIN",
        })),
      },
    });
    const ctrl = makeController(prisma);
    await expect(ctrl.detail("hidden-1")).rejects.toThrow(NotFoundException);
  });

  it("普通账号详情正常返回且不泄露 hidden 字段", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "u1",
          hidden: false,
          email: "a@b.c",
          name: "A",
          role: "ADMIN",
        })),
      },
    });
    const ctrl = makeController(prisma);
    const r = (await ctrl.detail("u1")) as Record<string, unknown>;
    expect(r.email).toBe("a@b.c");
    expect("hidden" in r).toBe(false);
  });
});
