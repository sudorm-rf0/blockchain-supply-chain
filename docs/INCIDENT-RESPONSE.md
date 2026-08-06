# 事件响应手册

## 分级

- **P0（资金损失/越权）**：立即暂停合约相关接口，通知管理员，冻结升级权限评估。
- **P1（可用性/数据损坏）**：回滚部署、恢复备份、观察监控。
- **P2（功能缺陷）**：记录工单，按发布流程修复。

## 响应步骤

1. 确认影响范围：日志、告警、链上事件、审计日志。
2. 阻断：必要时 `kubectl scale deployment/backend --replicas=0`；涉及合约则评估
   upgrade authority 冻结。
3. 恢复：按 `scripts/db-backup-restore.sh restore <dump>` 恢复数据库，
   按 `scripts/rollback-drill.sh` 回滚镜像。
4. 复盘：48 小时内出时间线、根因、修复与预防措施。

## 告警联系人

- 生产环境通过 Alertmanager 配置真实 Webhook/Slack/邮件；当前未配置真实渠道时
  告警无法送达，属于上线前阻塞项。

## 演练

- 数据库：`bash scripts/db-backup-restore.sh drill`
- 回滚：`PREVIOUS_TAG=<tag> bash scripts/rollback-drill.sh`
- 部署验证：`bash scripts/verify-deployment.sh`
