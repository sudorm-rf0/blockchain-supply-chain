# VPS 巡检 + Tailscale 安装记录（2026-09-22）

## 一、Tailscale 安装（零影响配置）

### 安装方式
```bash
curl -fsSL https://tailscale.com/install.sh | sh
systemctl start tailscaled
tailscale up --accept-dns=false --hostname=supply-chain-vps-a
```

### 关键安全选择（避免影响生产）
| 选项 | 原因 |
|------|------|
| `--accept-dns=false` | **关键**：Tailscale 默认会接管 `/etc/resolv.conf`（指向 100.100.100.100），生产服务器上可能影响域名解析 → 已禁用 |
| 不启用 `--accept-routes` | 避免把 tailnet 路由注入系统路由表（可能改变默认出口） |
| 不启用 `--advertise-routes` / `--exit-node` | 不改变整机转发行为 |
| 不启用 `--ssh` | 不引入额外的 SSH 认证通道 |

### 防火墙
```bash
ufw allow in on tailscale0 comment "tailscale"   # 仅作用于 tailscale0，公网规则不变
```

### 安装前后对比（验证零影响）
| 项目 | 安装前 | 安装后 |
|------|--------|--------|
| 默认路由 | `default via 103.39.79.1 dev ens18` | **相同** ✅ |
| `/etc/resolv.conf` | systemd-resolved stub | **相同**（无 tailscale/100.100.100.100） ✅ |
| 公网服务 | 200 | **200** ✅ |
| SSH 22/2222 | 正常 | **正常** ✅ |
| 新增接口 | — | `tailscale0`（仅用于 tailnet） |

### 登录
授权链接（一次性，约 15 分钟有效，过期可重新 `tailscale up` 生成）：
```
https://login.tailscale.com/a/29925c101f5f9
```
登录后验证：
```bash
tailscale status          # 应显示节点名 supply-chain-vps-a 与 100.x.y.z 地址
tailscale ip -4           # 查看 tailnet IP
```

### 卸载/回滚
```bash
tailscale down && systemctl disable --now tailscaled
apt-get remove -y tailscale tailscale-archive-keyring
# 快照备份：/root/_tailscale-backup/（ip addr/route/iptables/ufw/ports/resolv.conf）
```

## 二、VPS 巡检结果（2026-09-22 13:03）

| 分类 | 项目 | 结果 |
|------|------|------|
| 系统 | 负载 | 0.29（4 核，健康） |
| 系统 | 内存 | 已用 1866MB / **可用 1728MB** |
| 系统 | 磁盘 | 18G / 78G（**24%**，可用 57G） |
| 系统 | Swap | 23MB / 5670MB（几乎不用） |
| 容器 | 运行 | **16 个**，无异常 |
| 服务 | 网站 health / 登录页 | 200 / 200 |
| 服务 | 供应链栈 | 11 容器全 healthy |
| 链上 | 合约巡检 | **全部通过**（金库 vs 账面偏差 = 0） |
| 数据 | 数据库备份 | 每日正常（最新 09-22 10:00，153KB） |
| 安全 | fail2ban | 0 封禁（当前无攻击） |
| 安全 | ufw | active |
| 安全 | SSH | 22 + 2222 正常监听（4/4） |
| 证书 | supplychain.de5.net | 到期 **2026-11-09**（余 48 天，续期 cron 正常） |
| 监控 | cron | 21 个任务（监控/备份/巡检/续期/自愈） |
| 监控 | 日志 | 无异常告警 |

### 结论
**系统整体健康、资源充裕、无告警**。相比上午冻结事故时（内存可用 759MB → 现在 1728MB），资源压力已大幅缓解；
配合 earlyoom + sshd OOM 保护 + 容器内存上限，再次冻结的风险显著降低。

### 仍建议
- 内存 4GB 仍是结构性瓶颈（ClamAV 已占 ~940MB），如后续再上项目建议扩容到 8GB。

### ✅ 登录完成后的最终状态（2026-09-22 13:04）

| 项目 | 值 |
|------|-----|
| VPS 节点名 | `supply-chain-vps-a` |
| **VPS tailnet IP** | **`100.82.117.120`**（IPv6 `fd7a:115c:a1e0::e93a:7579`） |
| Mac 节点 | `macbook-air` / `100.105.15.117` |
| 后端状态 | Running / Online |
| tailscaled 开机自启 | enabled |
| tailnet ping | 0% 丢包（RTT 19-104ms） |
| tailnet SSH | ✅ 成功 |

### 零影响复核（登录后）
| 项目 | 结果 |
|------|------|
| 默认路由 | `via 103.39.79.1 dev ens18`（**未变**）✅ |
| `/etc/resolv.conf` | systemd-resolved stub，**无 100.100.100.100/tailscale** ✅ |
| `tailscale0` | `100.82.117.120/32`（独立接口，不影响 ens18） ✅ |
| 公网 SSH 22/2222 | 仍正常监听 ✅ |
| 网站 health | **200** ✅ |

### 日常使用（推荐作为管理主通道）
```bash
# 用 tailnet IP 登录（不经公网，不受 IP 封禁/防火墙影响）
ssh -i ~/.ssh/supply_chain_vps_a root@100.82.117.120

# 或用 MagicDNS 名称（如已在 tailnet 启用 MagicDNS）
ssh -i ~/.ssh/supply_chain_vps_a root@supply-chain-vps-a
```
> 价值：tailnet 是**独立于公网 IP 的管理通道**——即使以后再被 ufw/fail2ban 误封，
> 也能通过 `100.82.117.120` 进入修复，彻底摆脱"被封就失联"。

### 关闭/卸载
```bash
tailscale down                      # 临时断开
systemctl disable --now tailscaled  # 停止自启
apt-get remove -y tailscale tailscale-archive-keyring   # 卸载
```
