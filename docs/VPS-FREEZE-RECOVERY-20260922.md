# VPS 整机冻结事故与加固（2026-09-22）

## 一、现象
- 网站（Cloudflare）全部超时，`health` 返回 000
- **TCP 三层仍能握手**（IPv4 22/3000、IPv6 22），但**所有服务零响应**：
  - SSH：`kex_exchange_identification: Connection closed by remote host`
  - HTTP：`Empty reply from server`
- ICMP 大量丢包
- 第三方节点（Jina reader）验证同样超时 → **全局不可达，非本地网络或 IP 封禁问题**

## 二、判定
内核网络栈存活（能完成 SYN/ACK），但**用户态完全无法调度** →
典型「内存/IO 压力导致系统僵死（thrashing）」，远程无法自救，**必须重启**。
用户通过服务商控制台重启后恢复。

## 三、为何没有崩溃日志
`journald` 未开启持久化（`Storage=auto` 且 `/var/log/journal` 不存在）→ 重启后上一 boot 的内核日志全部丢失，无法定位元凶。
**已修复**：开启 `Storage=persistent`，下次可直接 `journalctl -k -b -1` 取证。

## 四、本次加固（4 项）
| # | 措施 | 作用 |
|---|------|------|
| 1 | **journald 持久化**（`Storage=persistent`） | 崩溃日志不再丢失，可事后定位 |
| 2 | **earlyoom**（`-m 10 -s 10`，优先杀 node/gitea/clamd，避开 sshd/systemd/dockerd） | 内存耗尽前主动终止大户，**避免整机僵死** |
| 3 | **sshd OOM 保护**（`OOMScoreAdjust=-1000`） | 内存再紧张也能 SSH 登入排障 |
| 4 | **容器内存上限**（postgres 1g / redis 512m / backup 256m / crowdsec 256m / xray 256m / wireguard 128m / wbc-app 768m 等，并写入 `deploy/vps/data-compose.yml`） | 单容器失控只影响自身，不拖垮整机 |

附带：监控内存告警阈值 `300MB → 500MB`（更早预警）。

## 五、IPv6 应急通道恢复
9/20 加固删除了 IPv6 的 OpenSSH 全网放行且只补了 IPv4 白名单 → **IPv6 应急通道失效**（本次故障期间无法通过 IPv6 进入）。
已恢复并收窄：
```bash
ufw allow from 2409::/16 to any port 22 proto tcp comment 'trusted-admin-ipv6'
ufw allow from 2409::/16 to any port 2222 proto tcp comment 'trusted-admin-ipv6'
# fail2ban ignoreip 同步加入 2409::/16
```
应急入口：
```bash
ssh -6 -i ~/.ssh/supply_chain_vps_a root@2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3
```

## 六、复检结果（重启 + 加固后）
| 项目 | 结果 |
|---|---|
| 网站 health / 登录页 | 200 / 200 |
| SSH IPv4 22 / 2222 | ✅ / ✅ |
| SSH IPv6 | ✅（应急通道已恢复） |
| 容器 | 31 运行，无异常 |
| 内存 | 766MB 可用 |
| earlyoom / journald | active / persistent |
| 磁盘 | 33% |

## 七、仍建议（结构性）
- **内存 4GB → 8GB**：ClamAV 已占 ~960MB，另有 gitea/nocobase/5 个 Node 服务，9/20 加固记录也建议扩容
- 长跑建议：`gaokao-nocobase`（536MB）按需关闭或限流
