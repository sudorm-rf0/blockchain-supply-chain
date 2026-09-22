# VPS 服务下线与资源清理（2026-09-22）

## 一、背景
VPS 曾因资源耗尽整机冻结（见 `VPS-FREEZE-RECOVERY-20260922.md`）。
本次按用户要求：下线不再使用的项目（保留配置与数据），并评估其余可清理项。

## 二、已下线（保留数据，重启不自启）

| 项目 | 组件 | 处理方式 |
|------|------|----------|
| **高考平台 gaokao** | 5 容器：`gaokao-nocobase`(503MB)、`gaokao-postgres`、`gaokao-ai-service`、`gaokao-nginx`、`gaokao-cloudflared` | `docker stop` + `restart=no`；compose/.env 备份至 `/root/_offline-backup-<ts>/`；**数据卷保留** |
| **USD→USDT escrow** | 容器 `usd-usdt-escrow-frontend`；systemd `usdt-chain.service`（hardhat 节点）、`cloudflared-usdt-escrow.service`（隧道） | `docker stop` + `restart=no`；`systemctl stop + disable`；unit/隧道配置备份；**数据保留 `/opt/usd-usdt-escrow/`** |
| **隐私池 PrivacyPool** | **无实际服务**（全盘搜索仅有 Let's Encrypt 证书残留；`privacypool.de5.net` 此前只是落到供应链应用） | 删除 Cloudflare A 记录（`privacypool.de5.net`、`www`），域名已下线；DNS 记录备份于 `/tmp/dns-backup/privacypool-dns.json` |
| **死隧道 ssh-backup-tunnel** | cloudflared 容器（Cloudflare 侧隧道已删除，容器空转） | `docker stop` + `restart=no` |

### 第二批下线（2026-09-22 12:45，用户确认）
| 项目 | 组件 | 数据保留位置 | 处理 |
|------|------|--------------|------|
| **chat 聊天平台** | `chat-chat-web-1`、`chat-chat-backend-1`、`chat-chat-db-1` + `chat-net-rules.service` | `/root/chat`（508K）+ 卷 `chat_chat-db-data`、`chat_chat-attachments` | stop + `restart=no`；systemd disable |
| **钱包余额检查 wbc** | `wbc-app`、`wbc-tunnel` | `/opt/wallet-balance-checker`（84K） | stop + `restart=no` |
| **Gitea**（GitHub 已恢复） | `gitea` | **`/opt/gitea/data`（22M）** | stop + `restart=no` |
| **verdaccio**（私有 npm 源） | `verdaccio` | `/opt/verdaccio` + 卷 `crates-cache` 外的 registry 数据 | stop + `restart=no` |
| **crates-proxy**（Rust 依赖镜像） | `crates-proxy` | `/opt/crates-proxy` | stop + `restart=no` |

配置备份目录：`/root/_offline-backup2-20260922-124548/`

> 域名影响：`wbc.dfr.cc.cd`、`chat.dfr.cc.cd` 因隧道停止返回 530（DNS 记录仍保留，需要时可恢复）。

### 副作用提示
`chat.dfr.cc.cd` 与 `usdt.dfr.cc.cd` 原先共用 `cloudflared-usdt-escrow` 隧道，
停隧道后这两个域名均返回 530（已下线）。若仍需 chat 对外，可单独恢复一条隧道。

## 三、资源变化
| 指标 | 最初 | 下线高考/USDT 后 | 第二轮下线后 |
|------|------|-----------------|--------------|
| 运行容器 | 31 | 24 | **16** |
| 内存可用 | 759 MB | 1496 MB | **1794 MB** |
| 负载 | — | 0.27 |
| 供应链栈 | healthy | **healthy（未受影响）** |

## 四、候选清理结果（第二轮已执行）

| 容器 | 内存 | 公网暴露 | 使用证据 | 建议 |
|------|------|----------|----------|------|
| `chat-*`（backend/web/db） | ~100MB | 曾 `chat.dfr.cc.cd`（现 530） | 日志仅 health 检查，无真实访问 | 建议下线 |
| `wbc-app` + `wbc-tunnel` | ~61MB | `wbc.dfr.cc.cd` | 日志仅 healthz | 待确认是否仍需要 |
| `verdaccio` | 71MB | 仅 127.0.0.1:4873 | 仅启动日志，无请求记录 | 若不发私有 npm 包可下线 |
| `crates-proxy` | 6MB | 仅 127.0.0.1:4874 | **无任何日志** | 若不编译 Rust 可下线 |
| `anisette` | 8MB | 0.0.0.0:6969 | 有活动日志 | Apple 相关工具，待确认 |
| `gitea` | 101MB | 0.0.0.0:3000 | **在用**（代码托管） | 保留 |
| `vaultwarden` | 23MB | 127.0.0.1:8088 | 密码管理 | 保留 |
| `proxy-xray/wireguard/crowdsec` | ~63MB | 代理端口 | **在用**（代理上网） | 保留 |
| `supply-chain-*`（11） | ~1.6GB | 生产 | 生产环境 | 保留 |

## 五、恢复方法

```bash
# 高考平台
cd /opt/gaokao-platform && docker compose -f docker-compose.vps.yml up -d

# USD→USDT
docker start usd-usdt-escrow-frontend
systemctl enable --now usdt-chain cloudflared-usdt-escrow

# 隐私池 DNS：从 /tmp/dns-backup/privacypool-dns.json 重新导入 A 记录
```
