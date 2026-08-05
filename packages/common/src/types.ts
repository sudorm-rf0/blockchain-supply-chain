/**
 * 共享 guard 依赖的最小 Prisma 查询接口（鸭子类型）。
 * 各服务注入自己生成的 PrismaService 实例，避免共享包耦合 @prisma/client
 * 及其生成位置。select 用 any 以兼容 Prisma 的 SelectSubset 泛型签名；
 * 具体类型安全由各服务工厂 provider 注入的真实 PrismaService 保证。
 */
export interface PrismaQueryLike {
  user: {
    findUnique(args: {
      where: { id: string };
      select?: any;
    }): Promise<any | null>;
  };
}
