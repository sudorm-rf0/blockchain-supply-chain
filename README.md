# Blockchain Supply Chain Monorepo

Solana/Anchor 供应链金融演示系统：单据上传审核、Solana 存证、贸易订单创建与
资金池快照。使用 pnpm workspaces + Turbo 管理。

## 包结构

- `packages/contracts`: Anchor 0.31.1 合约（`trade-finance` 全生命周期 + `supply-chain`），
  工具链为 Agave 4.1.2 + SBFv3。`supply-chain` 采用权限化注册：管理员（Registry）可
  授权/撤销供应商，仅管理员或已授权供应商可注册商品；主后端已接入供应链管理
  API，前端「供应链管理」页支持钱包签名完成初始化/授权/注册（详见 `docs/API.md`）。
- `packages/backend`: NestJS 11 主后端（认证、文件、存证）+ 3 个独立服务：
  `indexer-service`（链上监听与 DB 回写）、`trade-service`（订单预构建与确认）、
  `pool-service`（资金池总览与 LP 提款）。
- `packages/frontend`: Next.js 15 App Router + Tailwind + shadcn/ui + Solana 钱包。
  支持 Phantom / Backpack / Solflare / Coinbase Wallet / UnsolvedBloom。

## 系统架构

```mermaid
flowchart LR
  subgraph Users["用户端"]
    M["用户移动端<br/>拍照上传 / 钱包签名"]
    P["管理端 PC<br/>文件审核 / 订单 / 看板"]
  end
  subgraph Services["后端服务"]
    B["主后端 3001<br/>auth / files / audit"]
    T["trade-service 3004"]
    PL["pool-service 3005"]
    I["indexer-service 3003"]
  end
  subgraph Data["数据层"]
    PG[("Postgres 5432")]
    RD[("Redis 6380")]
  end
  subgraph Chain["Solana"]
    S["localnet 8899 / devnet"]
  end
  M -->|上传 / 存证| B
  P -->|审核 / 建单| B
  B --> PG
  B --> RD
  T -->|预构建 / 确认交易| S
  PL -->|NAV / LP 赎回| S
  I -->|监听账户变更| S
  I -->|回写快照| PG
  T -->|订单落库| PG
  PL -->|资金池快照| PG
```

## 本地启动

```bash
./init-monorepo.sh --infra
cd packages/backend && pnpm exec prisma generate && pnpm exec prisma migrate deploy
```

基础设施（Postgres / Redis / Solana localnet）：

```bash
docker compose up -d
```

`solana-localnet` 首次会构建 Agave 4.1.2 镜像（固定 `linux/amd64`，
Apple Silicon 上由 Docker 模拟运行），请确保构建时能访问 GitHub Releases。

合约构建与 localnet 部署：

```bash
cd packages/contracts
anchor build
cargo build-sbf --arch v3
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/trade_finance.so --program-id target/deploy/trade_finance-keypair.json
PATH="$HOME/.local/share/solana/active_release/bin:$PATH" solana program deploy \
  target/deploy/supply_chain.so --program-id target/deploy/supply_chain-keypair.json
```

后端服务（默认端口）：

```bash
cd packages/backend
pnpm dev              # 主后端 3001
pnpm dev:indexer      # 3003（需 REDIS_URL=redis://localhost:6380）
pnpm dev:trade        # 3004
pnpm dev:pool         # 3005（需 REDIS_URL=redis://localhost:6380）
```

一键启动全部本地服务（validator 需先由 `docker compose up -d` 提供，
首次先 `node scripts/init-localnet.mjs | tee infra/config/localnet.env`）：

```bash
bash scripts/dev-all.sh
```

前端：

```bash
cd packages/frontend
FRONTEND_PORT=3100 pnpm dev
```

打开 `http://localhost:3100`。种子管理员：`admin@supply-chain.io` /
`Admin123!`（可用 `pnpm --filter @supply-chain/backend prisma:seed` 重建）。

一键健康检查（后端、RPC、前端）：

```bash
bash scripts/health-check.sh
```

不想启动后端时，可直接打开根目录 `demo.html` 演示“用户拍照上传 → 链上存证 →
管理员 PC 审核并查看图片”的完整流程。

## 测试

```bash
pnpm --filter @supply-chain/backend exec jest --runInBand
cd packages/contracts && pnpm test
cd packages/frontend && pnpm build
```

合约测试（`packages/contracts` 的 `pnpm test`）会自动管理一个隔离的
`solana-test-validator`：随机空闲端口（不占用 8899 等开发端口）、以
`cargo build-sbf --arch v3`（SBFv3/eBPF，Agave 4.1.2 要求）构建并部署两个合约，
跑完自动清理账本与验证器进程。

CI 说明：`changes` 前置 job 按路径过滤，backend/frontend/security-audit 可跑在
本地 self-hosted runner（`codex-mac`，macOS ARM64，不计费）；合约/e2e/监控/
备份 job 使用 GitHub 托管 runner。密钥扫描由 `scripts/scan-secrets.sh` 执行
（工作区 + Git 历史），发现疑似凭据即失败。

## 部署

Kubernetes 部署与镜像构建见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，上线前
核对项见 [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md)。

## 文档

- [演示手册](docs/DEMO.md)：本地 Demo 账号、流程与重置
- [部署手册](docs/DEPLOYMENT.md)（中文）/[DEPLOYMENT.en.md](docs/DEPLOYMENT.en.md)（English）
- [操作手册](docs/OPERATIONS.md)（中文）/[OPERATIONS.en.md](docs/OPERATIONS.en.md)（English）
- [演示视频脚本](docs/VIDEO-SCRIPT.md)：8 个分镜的中英文旁白与录屏建议
- [接口文档](docs/API.md)：认证、文件、订单、资金池、索引器全部接口
- [上线运行手册](docs/GO-LIVE-RUNBOOK.md) 与
  [上线核对清单](docs/LAUNCH-CHECKLIST.md)
- [Phase 2 云资源清单](docs/PHASE2-CLOUD-CHECKLIST.md)：真实上线前置资源与排期
- [devnet → 主网迁移清单](docs/MAINNET-MIGRATION.md)：上线时链上重建/配置替换/测试重跑
- [审计经济模型](docs/AUDIT-ECONOMIC-MODEL.md) 与 [已知风险](docs/AUDIT-KNOWN-RISKS.md)：第三方审计材料
- [隐私/条款模板](docs/PRIVACY-TERMS-TEMPLATE.md) 与 [上线值班 SOP](docs/ONCALL-SOP.md)
- [审计发送清单与询价模板](docs/AUDIT-DELIVERY.md)
- [技术成本估算](docs/COSTS.md)（不含审计）
- [应急预案](docs/INCIDENT-RUNBOOK.md)
- [审计报告](docs/AUDIT-REPORT.md) 与
  [压测报告](docs/LOAD-TEST-REPORT.md)、[NEST-11-UPGRADE.md](docs/NEST-11-UPGRADE.md)
