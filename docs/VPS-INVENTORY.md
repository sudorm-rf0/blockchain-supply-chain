# VPS 服务器清单（Inventory）

> 维护：部署时更新　最近更新：2026-08-11
> 用途：登记已开通的 VPS 与网络信息，供 `deploy/vps/` 部署和
> `docs/CLOUD-RESOURCE-REPORT.md` 成本核算对照。含敏感信息，勿提交公网。

## 1. 总览

| 编号 | 角色 | 地域 | IPv4 | IPv6 | 状态 |
|---|---|---|---|---|---|
| VPS-01 | **VPS-A 应用机**（已确认） | 香港 | `103.39.79.7` | `2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3` | ✅ 已连接并完成部署准备 |
| VPS-02 | VPS-B 数据机 | - | 待开通 | 待开通 | ⏳ 未购买 |

> ⚠️ 按 2×VPS 方案（应用机 + 数据机）还缺 VPS-B（Postgres/Redis/备份）。

## 2. VPS-01 网络信息（2026-08-11 实测确认）

| 项 | 值 |
|---|---|
| 网卡（系统内） | **ens18**（控制台显示 eth0，实际为 ens18） |
| 外网 IPv4 | `103.39.79.7/24`（DHCP，源地址确认） |
| IPv4 网关 | `103.39.79.1` |
| IPv6 地址 1 | `2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3/128`（已在网卡上） |
| IPv6 地址 2 | `2400:f880:1d:8362:2a0f:72ea:ee05:e518/128`（**第二个地址，非网关**） |
| IPv6 默认路由 | `fe80::b696:91ff:fecd:c279`（link-local RA，SLAAC） |
| IPv4 归属（WHOIS） | HONG KONG ALPHA INTL LTD（ALPHAINTL-HK，旺角） |
| IPv6 归属（WHOIS） | Converged Communications Limited（RONGHE-HK） |
| 地域含义 | **香港 VPS：国内访问无需 ICP 备案**，域名解析即可用 |

## 3. VPS-01 系统与配置（2026-08-11 实测）

| 项 | 值 |
|---|---|
| 主机名 | VM120013 |
| 系统 | Ubuntu 22.04.3 LTS（x86_64） |
| 规格 | **4 vCPU / 3.8Gi RAM / 1.5Gi Swap / 78GB 磁盘（71GB 可用）** |
| SSH | root，端口 22，密钥登录已启用（本机 `~/.ssh/supply_chain_vps_a`），密码登录仍开启；
| SSH 别名 | `vps-a`（已写入 `~/.ssh/config`，`ssh vps-a` 免密直连） |
| Docker | 29.1.3（已启动） |
| Docker Compose | 2.40.3（`docker compose` v2 插件） |
| 防火墙 | UFW active：默认拒绝入站，放行 22/80/443（v4+v6） |
| 加固 | fail2ban 已安装并运行 |
| 部署状态 | **已部署并全链路验证**（2026-08-12）：单机全栈（Postgres/Redis/4 后端/前端/Nginx），`http://103.39.79.7` 登录/注册/上传/回读全部通过，文件已切 Cloudflare R2 |
| 部署方式 | 单机：`/opt/supply-chain` + 共享网络 `supply-chain-net`（数据/应用同机，DB/Redis 不暴露公网） |
| 看护 | cron 每 2 分钟健康检查，3 次失败自动重启服务（`/usr/local/bin/supply-chain-watchdog.sh`） |

### 3.1 待办/建议

- [x] 2026-08-11 完成单机测试部署（VPS-B 未购买，Postgres/Redis 暂跑在 VPS-A 上）
- [x] SSH 密码登录已关闭（`PasswordAuthentication no`，仅密钥）
- [ ] **修改 root 密码**（密码曾在聊天中明文提供，建议立即更换）
- [ ] 记录到期时间 / 续费价格 / 实付成本
- [ ] 开通 VPS-B 数据机；两台之间若有内网，用内网 IP 互通
- [ ] 域名接入后启用 HTTPS（可先用 `103-39-79-7.sslip.io` + Let's Encrypt，配置已备）

## 4. 与部署文档的对接点

| 对接点 | 用 VPS-01 的值 |
|---|---|
| DNS：A 记录 → 域名 | `103.39.79.7`（如需 IPv6 再配 AAAA：`2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3`） |
| `PUBLIC_BASE_URL` / `NEXT_PUBLIC_*` | `https://<你的域名>` |
| VPS-B 防火墙白名单 | 放行 VPS-A 公网 IP `103.39.79.7`（若同一机房用内网 IP） |
| 部署命令（在 VPS-A 上） | `git clone` 后 `bash scripts/deploy-vps.sh`（见 `deploy/vps/README.md`） |
| 健康检查 | `curl -s https://<域名>/health` |

## 5. 安全清单（已完成的打勾）

- [x] SSH 密钥登录（本机 `~/.ssh/supply_chain_vps_a`，免密验证通过）
- [x] UFW 防火墙：仅放行 22/80/443
- [x] fail2ban 防暴力破解
- [ ] 5432/6379 不暴露公网（VPS-B 部署时来源仅限 VPS-A）
- [ ] SSH 密码登录关闭（待确认）
- [ ] 每日自动备份（VPS-B 的 backup 容器）

## 6. 成本登记（对照 CLOUD-RESOURCE-REPORT.md §7）

- 香港 VPS：实际规格 **4C4G/80GB**，按海外轻量常规价估算约 ¥100-200/月（高于方案假设的 2C4G ¥60-100/月）。
- 若购买的是促销新用户价，续费按常规价，登记时注明实付。
