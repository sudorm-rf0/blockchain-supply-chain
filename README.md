# Blockchain Supply Chain Monorepo

Solana/Anchor 供应链金融演示系统：单据上传审核、Solana 存证、贸易订单创建与
资金池快照。使用 pnpm workspaces + Turbo 管理。

## 包结构

- `packages/contracts`: Anchor 0.30.1 合约（`trade-finance` 全生命周期 + `supply-chain`）。
- `packages/backend`: NestJS 10 主后端（认证、文件、存证）+ 3 个独立服务：
  `indexer-service`（链上监听与 DB 回写）、`trade-service`（订单预构建与确认）、
  `pool-service`（资金池总览与 LP 提款）。
- `packages/frontend`: Next.js 14 App Router + Tailwind + shadcn/ui + Solana 钱包。

## 本地启动

```bash
./init-monorepo.sh --infra
cd packages/backend && pnpm exec prisma generate && pnpm exec prisma migrate deploy
```

基础设施（Postgres / Redis / Solana localnet）：

```bash
docker compose up -d
```

合约构建与 localnet 部署：

```bash
cd packages/contracts
anchor build
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" anchor deploy --provider.cluster localnet
```

后端服务（默认端口）：

```bash
cd packages/backend
pnpm dev              # 主后端 3001
pnpm dev:indexer      # 3003（需 REDIS_URL=redis://localhost:6380）
pnpm dev:trade        # 3004
pnpm dev:pool         # 3005（需 REDIS_URL=redis://localhost:6380）
```

前端：

```bash
cd packages/frontend
FRONTEND_PORT=3100 pnpm dev
```

打开 `http://localhost:3100`。种子管理员：`admin@supply-chain.io` /
`Admin123!`（可用 `pnpm --filter @supply-chain/backend prisma:seed` 重建）。

## 测试

```bash
pnpm --filter @supply-chain/backend exec jest --runInBand
cd packages/contracts && pnpm test
cd packages/frontend && pnpm build
```

## 部署

Kubernetes 部署与镜像构建见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，上线前
核对项见 [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md)。

## 文档

- [部署手册](docs/DEPLOYMENT.md)：本地/镜像/K8s/devnet 部署与回滚
- [操作手册](docs/OPERATIONS.md)：环境变量、巡检、备份、故障处理
- [接口文档](docs/API.md)：认证、文件、订单、资金池、索引器全部接口
- [上线运行手册](docs/GO-LIVE-RUNBOOK.md) 与
  [上线核对清单](docs/LAUNCH-CHECKLIST.md)
- [审计报告](docs/AUDIT-REPORT.md) 与
  [压测报告](docs/LOAD-TEST-REPORT.md)
