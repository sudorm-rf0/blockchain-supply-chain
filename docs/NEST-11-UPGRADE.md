# NestJS 11 升级评估

日期：2026-08-04（已执行）

## 背景

当前后端使用 NestJS `10.4.22`。依赖审计中 `@nestjs/core` 的 moderate 漏洞
（GHSA-36xv-jgw5-4q75，注入类问题）修复版本为 `>=11.1.18`，Nest 10 没有
补丁。升级到 Nest 11 是消除该告警的唯一官方路径。

## 影响面

4 个独立服务全部基于 Nest 10：

- 主后端（`src/`，auth/files/audit/admin/observability）
- `indexer-service`
- `trade-service`
- `pool-service`

当前测试基线：后端 Jest 101 用例、合约 23 用例、前端 13 用例。

## 需要同步升级的依赖

| 包 | 当前 | 目标 |
| --- | --- | --- |
| `@nestjs/common` | 10.4.22 | ^11.1.18 |
| `@nestjs/core` | 10.4.22 | ^11.1.18 |
| `@nestjs/platform-express` | 10.4.22 | ^11.1.18 |
| `@nestjs/schedule` | 4.1.0 | 与 Nest 11 匹配的 major |
| `@nestjs/throttler` | 6.x | 兼容 Nest 11 的版本 |
| `@nestjs/swagger` | 当前 | 兼容 Nest 11 的版本 |
| `@nestjs/testing`（dev） | 当前 | 兼容 Nest 11 的版本 |

`@solana/*`、Prisma、Redis 客户端不随 Nest 升级。

## 关键兼容性风险

1. **Express 5**：`@nestjs/platform-express@11` 默认 Express 5。
   - 路由通配符语法变化（`*` → `/{*splat}` 形式）。
   - `path-to-regexp` v8 对特殊字符更严格，需要核对所有 `@Controller` 路径。
   - 已有 `path-to-regexp` override 至 3.3.0，升级后应移除并验证。
2. **body-parser / multer**：Express 5 内置 body-parser 行为变化；
   当前 override 了 `multer@2` 与 `body-parser`，升级后需回归文件上传。
3. **TypeScript 类型**：`Request`/`Response` 类型、部分装饰器签名可能
   变化，`tsconfig` strict 下需要逐个服务编译确认。
4. **ScheduleModule**：还款到期通知与审计保留策略依赖 `@nestjs/schedule`，
   升级后需验证 cron 注册。

## 迁移步骤

1. 在独立分支执行：
   `pnpm -w add -D @nestjs/{common,core,platform-express,schedule,throttler,swagger,testing}@^11 --workspace-root` 及 backend 对应升级。
2. 删除临时 overrides（`multer`/`body-parser`/`path-to-regexp` 视 Express 5 需要保留或移除）。
3. `pnpm build` 逐个服务编译，修复类型错误。
4. `pnpm exec jest --runInBand` 全量回归（101 用例）。
5. 本地起 4 个服务跑 `scripts/smoke-e2e.sh`（10 项）与
   `scripts/load-test/upload-test.mjs` 上传回归。
6. `pnpm audit --prod --registry https://registry.npmjs.org` 确认
   `@nestjs/core` 告警消失（预期剩 `bigint-buffer` 1 个 high 无补丁）。
7. CI 全绿后合入；合约与前端不涉及本次升级。

## 结论

风险中等、工作量集中在 Express 5 路由与类型适配。建议作为独立升级项
（1-2 天），不与其他功能迭代混用；升级后可消除剩余 1 个 moderate 漏洞。

## 执行结果

- 已升级：`@nestjs/common/core/platform-express/testing` 11.1.28、
  `@nestjs/schedule` 6.1.3、`@nestjs/swagger` 11.4.6、`@nestjs/throttler` 6.5.0、
  `@nestjs/cli/schematics` 11.0.24、`@types/express` 5。
- 移除根 overrides 中与 Express 5 冲突的 `path-to-regexp@3` 与
  `body-parser@1`，Express 5 使用自带依赖。
- 验证：后端 Jest 101/101、四个服务构建通过、`scripts/smoke-e2e.sh` 10/10、
  本地四服务健康检查通过。
- 依赖审计：`@nestjs/core` moderate 告警消失，生产依赖漏洞降至
  1 个（`bigint-buffer`，无补丁）。
