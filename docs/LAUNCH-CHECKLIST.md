# 上线核对清单

## 合约与链

- [ ] 在 devnet 部署 `trade-finance` 与 `supply-chain`，验证 Program ID 与本地一致。
- [ ] 部署后运行 `scripts/init-supply-chain.mjs <供应商公钥...>` 初始化 `Registry`
      并授权真实供应商（幂等，可重复执行）。
- [ ] 核对 `Registry.admin` 与供应商授权记录（脚本输出 `REGISTRY_ADMIN` 与
      `AUTHORIZED_SUPPLIERS`）。
- [ ] 由独立审计方完成合约审计，修复后再部署主网。
- [ ] 保管 upgrade authority 私钥，主网部署后考虑冻结升级权限。
- [ ] 配置正式 RPC（如 Helius/QuickNode），不要用公共限流端点。
- [ ] 核对 USDC Mint 为正式地址，本地测试 Mint 不得出现在生产。

## 安全

- [ ] `JWT_SECRET`、数据库密码、Redis 密码由密钥管理系统（Vault/云 Secret）注入。
- [ ] 全站启用 HTTPS，Ingress TLS 证书自动续期。
- [ ] 上传文件迁移到 S3/OSS 或至少启用 PVC 加密与生命周期策略。
- [ ] 建立管理端审计日志与登录风控。
- [ ] 定期轮换密钥并演练吊销流程。

## 数据与可靠性

- [ ] Postgres 每日备份 + 异地副本 + 月度恢复演练。
- [ ] Redis 开启 AOF 持久化（K8s 清单已配置）并监控内存。
- [ ] indexer 加入重放与滞后者指标；`sync-queue` 失败告警。
- [ ] 接入 Sentry/APM 与 Prometheus 指标，告警到 IM/邮件。

## 流程

- [ ] CI 全绿：后端 Jest、前端 build、合约 build + 测试、Docker 镜像构建。
- [ ] 灰度发布：先 devnet 冒烟，再 staging，最后主网。
- [ ] 制定回滚方案（保留前一版本镜像与数据库迁移脚本）。
- [ ] 完成隐私政策、服务条款与数据跨境合规评审。

## 已知边界（当前 demo 未覆盖）

- LP 提款到 `READY` 后，链上执行需管理员签名或智能合约自动化。
- `trade-service` 创建订单依赖资金池已初始化、USDC 与买方 ATA 存在。
- 文件存储已支持 S3/OSS 驱动，生产只需配置 `STORAGE_DRIVER=s3`。
