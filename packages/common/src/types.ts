/**
 * 共享 guard 依赖的最小 Prisma 查询接口（鸭子类型）。
 * 各服务注入自己生成的 PrismaService 实例，避免共享包耦合 @prisma/client
 * 及其生成位置。select 用 any 以兼容 Prisma 的 SelectSubset 泛型签名。
 *
 * 依赖注入：guard 构造参数用 @Inject(PRISMA_SERVICE) 显式 token，各服务模块
 * 通过 { provide: PRISMA_SERVICE, useExisting: PrismaService } 提供，保证
 * Nest 无论从哪个模块作用域实例化 guard 都能正确解析。
 */
export const PRISMA_SERVICE = Symbol("PRISMA_SERVICE");

export interface PrismaQueryLike {
  user: {
    findUnique(args: {
      where: { id: string };
      select?: any;
    }): Promise<any | null>;
  };
  $queryRaw(query: TemplateStringsArray, ...values: any[]): Promise<unknown>;
  auditLog: {
    create(args: {
      data: {
        actorId?: string | null;
        actorEmail?: string | null;
        action: string;
        targetType: string;
        targetId: string;
        metadata?: any;
      };
    }): Promise<unknown>;
  };
}
