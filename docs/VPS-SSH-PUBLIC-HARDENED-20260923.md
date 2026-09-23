# SSH 全网开放 + 强化防护（2026-09-23）

## 一、背景
9/20 加固把 SSH 22 收窄为白名单（`120.229.0.0/16`、`120.235.0.0/16`、`79.127.159.119`、`36.230.11.199` 等）。
用户 IP 变动后无法登录（当日出口 `180.164.63.211` 不在白名单），故改为**全网开放 + 强防护**，
并借助已安装的 Tailscale 作为独立管理通道完成改配。

## 二、最终访问路径
| 路径 | 地址 | 说明 |
|------|------|------|
| **公网 SSH** | `103.39.79.7:22` | ✅ 全网开放，ufw `limit` 限速 |
| **Tailnet SSH** | `100.82.117.120:22` | 经 Tailscale SSH（需 ACL check 授权） |
| **Tailnet 备线** | `100.82.117.120:2222` | 直达系统 sshd（密钥认证，无需 Tailscale check） |
| 公网 2222 | — | ❌ 已关闭（仅 tailnet 可达），作为"静默备线" |

## 三、防护措施（多层）
| 层 | 配置 | 作用 |
|----|------|------|
| **认证** | `PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PubkeyAuthentication yes`、`PermitEmptyPasswords no`、`PermitRootLogin prohibit-password` | **仅密钥登录**，密码通道完全关闭 |
| **连接控制** | `MaxAuthTries 3`、`LoginGraceTime 20`、`MaxStartups 30:60:200` | 限制认证尝试与并发未认证连接 |
| **ufw 限速** | `ufw limit 22/tcp`（Anywhere + v6） | 同 IP 30 秒内 >6 次新连接自动拒绝，抗连接洪水 |
| **fail2ban** | `mode = aggressive`、`maxretry 5`、`findtime 10m`、`bantime 24h`、`bantime.increment = true`（×2，上限 1 周）、`banaction = ufw`（双栈） | 暴力破解自动封禁，累犯阶梯式加长 |
| **fail2ban 白名单** | `ignoreip` 含 `100.64.0.0/10`（tailnet）、本机、用户动态网段（120.229/120.235/111.55/223.104/27.38/163.125/183.11/14.112、2409::/16） | 避免管理通道被自己封禁 |
| **OOM 保护** | `ssh: OOMScoreAdjust=-1000` + earlyoom | 内存紧张时 SSH 仍可登录排障 |
| **防火墙默认** | ufw `DEFAULT_INPUT_POLICY=DROP` | 除显式放行外一律拒绝 |

## 四、验证结果
| 项目 | 结果 |
|------|------|
| 公网 22（新 IP `180.164.63.211`） | ✅ 登录成功（0.83s 握手，返回 SSH banner） |
| Tailnet 2222 | ✅ 登录成功 |
| 公网 2222 | ✅ 已关闭（5s 超时 = DROP，非监听失败） |
| fail2ban 过滤器 | ✅ 合成日志匹配成功（maxretry 5 / findtime 600s / bantime 86400s） |
| fail2ban 运行 | ✅ active；banaction = ufw（覆盖 IPv4+IPv6） |
| 网站 health（VPS 出口） | ✅ 200 |
| 供应链容器 | ✅ 11 个全运行 |
| 系统 | 负载 0.33、内存可用 **1912MB** |

> 注：本地 Mac 直连 `supplychain.de5.net` 与 `cloudflare.com` 均返回 000（本地网络直连 Cloudflare 不通），
> 经代理访问为 **200** → **属本地网络问题，服务器正常**。

## 五、回滚 / 备份
- 备份目录：`/root/_ssh-open-backup-<时间戳>/`（改前的 ufw 规则、jail.local、sshd 配置）
- 恢复白名单模式：
```bash
ufw --force delete <limit-22 规则号>
ufw allow from <你的IP> to any port 22 proto tcp comment 'trusted-admin'
```
- 临时关闭 fail2ban：`systemctl stop fail2ban`
- 彻底恢复 9/20 加固状态：把备份的 jail.local / ufw_before.txt 复原

## 六、建议
- 公网开放 SSH 依赖"仅密钥 + 限速 + fail2ban"，当前配置合理；如需更强隔离可改为**仅 tailnet 可 SSH**（公网 22 关闭）
- 建议开启 fail2ban 的邮件告警（当前仅封禁记录），以便发现大规模扫描

---

## 七、故障修复：ufw 连接限速误封（2026-09-23 20:20）

### 现象
公网 SSH 22 再次超时；但 ICMP 通、网站 200、**tailnet:2222 可登录**（说明 VPS 正常，仅公网 22 被挡）。

### 根因
`ufw limit 22/tcp` 的连接限速机制：
```
-A ufw-user-input -p tcp --dport 22 -m conntrack --ctstate NEW -m recent --set
-A ufw-user-input -p tcp --dport 22 -m conntrack --ctstate NEW \
   -m recent --update --seconds 30 --hitcount 6 -j ufw-user-limit     # 超 6 次 → DROP
```
- 同 IP **30 秒内超过 6 次新连接**即被 DROP
- **关键缺陷**：每次重试都会刷新 30 秒窗口 → 持续重试 = 持续被封（不会自动解除）
- 触发原因：短时间内多次 SSH 测试/多会话操作（正常管理行为，非攻击）

### 修复
| 步骤 | 操作 |
|------|------|
| 1 | 删除 `ufw limit 22/tcp`（触发误封的规则，IPv4+v6） |
| 2 | 改为 `ufw allow 22/tcp comment 'ssh public (fail2ban protected)'` |
| 3 | 防护完全交给 **fail2ban**（只在认证失败时封禁，不受连接次数影响） |
| 4 | 当前 IP `180.164.63.211` 加入 fail2ban `ignoreip` |

### 为什么改用 fail2ban 单防线
| 机制 | 触发条件 | 对正常管理的误伤风险 |
|------|----------|---------------------|
| ~~ufw limit~~ | **连接次数**（30s/6 次） | ❌ 高（多会话/重试即封，且不自动解除） |
| **fail2ban** | **认证失败 5 次 / 10 分钟** | ✅ 低（密钥登录成功不计数） |

### 验证（修复后）
| 项目 | 结果 |
|------|------|
| 公网 22 单次登录 | ✅ 成功 |
| 公网 22 **连续 3 次快速连接** | ✅ ✓✓✓ 全部成功（不再误封） |
| tailnet 2222 | ✅ 正常 |
| 网站（经代理） | ✅ 200 |
| fail2ban 防护 | ✅ 仍处活跃封禁 13 个真实攻击 IP |

### 经验教训（本机运维）
> **不要用连接频次限制来保护"需要频繁使用的管理通道"**。
> 管理通道的正确保护是：仅密钥认证 + 认证失败封禁（fail2ban）+ 独立备用通道（Tailscale）。
> 连接频次限制适合保护无人值守的公网服务，不适合 SSH 管理入口。
