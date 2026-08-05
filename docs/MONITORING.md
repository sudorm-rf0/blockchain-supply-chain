# 监控与备份演练

## 1. 备份恢复演练

一键执行完整 drill：真实备份 -> 恢复到临时库 -> 逐表核对行数 -> 输出 JSON 报告 ->
自动清理临时库。

```bash
bash scripts/db-backup-restore.sh drill
```

报告默认写到 `/tmp/backup-drill-report.json`，包含每张表的
`status: PASS/FAIL` 和 `detail`。核心表：

| 逻辑表 | 实际表 |
| --- | --- |
| User | `"User"` |
| TradeDeal | `"TradeDeal"` |
| PoolSnapshot | `"PoolSnapshot"` |
| WithdrawRequest | `withdraw_requests` |
| File | `files` |
| AuditLog | `audit_logs` |
| RefreshToken | `refresh_tokens` |

其它命令：

```bash
# 只备份
bash scripts/db-backup-restore.sh backup

# 用已有 dump 恢复到临时库并验证
bash scripts/db-backup-restore.sh restore /path/to/backup.dump
```

环境变量：

- `CONTAINER` / `POSTGRES_USER` / `DB`：默认 `supply-chain-postgres` /
  `postgres` / `supply_chain`。
- `TEST_DB`：临时库名，默认带时间戳避免冲突。
- `DUMP_PATH` / `REPORT_PATH`：备份与报告路径。
- `KEEP_TEMP=1`：保留临时库，便于人工复核。

## 2. 监控验证

一键验证告警规则语法、规则数量、四个服务的 `/metrics`：

```bash
bash scripts/verify-monitoring.sh
```

- 使用本机 `promtool check rules infra/prometheus/alerts.yml` 校验规则语法。
- 检查 `3001/3003/3004/3005` 的 `/metrics` 是否暴露
  `http_requests_total`、`http_request_duration_seconds`、
  `process_start_time_seconds`；`3001` 额外检查 `csp_violations_total`。
- 检查 `infra/prometheus/prometheus.yml` 已配置 `alertmanager:9093` 目标。
- 设置 `PROMETHEUS_URL` 后额外检查 Prometheus 已加载的规则数；
  设置 `GRAFANA_URL` 后检查 Grafana 健康。
- 报告输出到 `/tmp/monitoring-verify-report.json`，任一 FAIL 即退出码 1。

## 3. Prometheus / Grafana 配置

- `infra/prometheus/prometheus.yml`：抓取 backend/indexer/trade/pool 四个服务，
  默认目标为 K8s Service 名（`backend:3001` 等），本地验证可用 `sed` 替换为
  `localhost` 或 `host.docker.internal`；已配置
  `alerting.alertmanagers` 指向 `alertmanager:9093`。
- `infra/prometheus/alerts.yml`：7 条告警（服务下线、5xx 比例、队列失败、
  索引器陈旧、P99 延迟、内存水位、CSP 违规上报、Blackbox 探针、TLS 到期）。
- `infra/blackbox/blackbox.yml`：Blackbox Exporter HTTP 探针模块；
  `deploy.sh` 根据 `PUBLIC_BASE_URL` 生成探针目标
  （`/health`、`/health/ready`、`/login`），由 Prometheus 的
  `blackbox` job 抓取 `probe_success`。
- `infra/grafana/dashboards/supply-chain.json`：大盘，覆盖请求量、5xx、
  P99、堆内存、事件循环、索引器队列。
- `infra/grafana/provisioning/`：Grafana 自动加载 datasource 与 dashboard 的
  provisioning 配置；挂载到 Grafana 容器即可：

```bash
docker run -d --name grafana -p 3300:3000 \
  -v "$PWD/infra/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v "$PWD/infra/grafana/dashboards:/var/lib/grafana/dashboards:ro" \
  grafana/grafana
```

K8s 部署时把两个目录作为 ConfigMap/Volume 挂载到 Grafana 对应路径。

## 4.1 Alertmanager 真实告警渠道

Alertmanager 默认只提供占位配置；上线前必须至少配置一种真实渠道：

```bash
# 钉钉 / 企业微信 / 通用 Webhook
ALERTMANAGER_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=xxx" \
  bash scripts/configure-alertmanager-webhook.sh

# Slack Incoming Webhook（可与 Webhook 同时启用）
ALERTMANAGER_SLACK_URL="https://hooks.slack.com/services/xxx/yyy/zzz" \
  ALERTMANAGER_SLACK_CHANNEL="#alerts" \
  bash scripts/configure-alertmanager-webhook.sh

# SMTP 邮件（可同时启用）
ALERTMANAGER_EMAIL_TO="ops@example.com" \
ALERTMANAGER_SMTP_SMARTHOST="smtp.example.com:587" \
ALERTMANAGER_SMTP_FROM="alert@example.com" \
  bash scripts/configure-alertmanager-webhook.sh
```

脚本输出 `k8s/alertmanager-config.generated.yaml`，`deploy.sh` 会优先应用它；
没有 generated 配置但设置了 `ALERTMANAGER_*` 环境变量时，`deploy.sh` 也会
临时生成后再 apply。生成前请确认 URL / SMTP 凭据只通过环境变量传入，不要
写进仓库。

`configure-alertmanager-webhook.sh` 会按 `severity` 分级路由：`critical`
（服务下线、Blackbox 探针失败等）走独立 receiver（邮件 + Slack），
`warning` 走默认 receiver（Webhook + Slack）。

## 4.2 CSP 违规上报告警

- 前端通过 CSP `report-uri` 把浏览器违规上报到
  `{NEXT_PUBLIC_BACKEND_URL}/api/csp-report`；显式设置
  `NEXT_PUBLIC_CSP_REPORT_URI` 可覆盖默认地址。
- 后端 `POST /api/csp-report` 解析新旧两种报告格式，累加
  `csp_violations_total{directive, disposition}` 指标，并记录告警日志。
- Prometheus 规则 `CspViolationDetected` 在 5 分钟内出现违规时触发 warning，
  经 Alertmanager 推送到已配置的 Webhook / Slack / 邮件。

## 4. Kubernetes 一键部署

```bash
DEPLOY_MONITORING=1 NAMESPACE=supply-chain \
REGISTRY=your-registry/supply-chain TAG=latest bash scripts/deploy.sh
```

- `deploy.sh` 从 `infra/prometheus` / `infra/grafana` 生成 ConfigMap，
  避免手工复制配置。
- 同时应用 Prometheus（9090）、Grafana（3000）、Alertmanager（9093）
  三个 Deployment/Service，并等 rollout 完成。
- `postgres-backup-drill-cronjob.yaml` 每月自动做备份恢复演练，任一行数
  不匹配即 Job 失败，便于监控到备份失效。
