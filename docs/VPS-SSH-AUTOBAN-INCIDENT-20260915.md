# VPS SSH 失联事故复盘：自动封禁误封自有动态 IP（2026-09-15）

## 一、现象
- IPv4 SSH（22 / 2222）**连接超时**（不是 refused）→ 典型 DROP
- 但 **IPv6 SSH 正常**（`2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3`）
- 同时段 Gitea（3000）、网站（Cloudflare 443）均正常 → VPS 未宕机
- Ping 正常（25ms），说明链路可达、仅 TCP SSH 被丢弃

## 二、根因
`/usr/local/bin/proxy-autoban.sh`（cron 每 5 分钟）逻辑为：
> 扫描 xray access.log，把「白名单之外、连上代理的 IP」直接 `ufw insert 1 deny`

**白名单只有 2 个硬编码 IP**：`120.229.163.108 163.125.200.78`
而家庭 / 手机宽带 IP 是**动态**的（广东移动：120.229.x / 120.235.x / 111.55.x / 223.104.x / 27.38.x / 163.125.x / 183.11.x）。
一旦换 IP，且脚本运行时该 IP「当下没有活跃连接」，就会被**自己的脚本封禁**。

**证据**（`/var/lib/proxy-observe/autoban-actions.log`）：
```
[2026-09-14_04:05:01] 🚨 自动封禁未知来源: 120.235.215.163
[2026-09-14_14:20:01] 封禁 111.55.209.160 时的上下文:
2026/09/14 14:16:46 from 111.55.209.160:29170 accepted tcp:www.gstatic.com:443 [hk-ws >> direct] email: shared@hk
```
上下文显示被封 IP 正是用户本人经 VPS 代理节点（hk-ws）上网的会话。
累计误封 **32 次**，全部为自有动态 IP。

## 三、修复（2026-09-15）
1. **清除误封**：删除 ufw 中 31 条由该脚本写入的 `DENY IN` 规则（保留境外真实攻击者的规则）
2. **重写 `proxy-autoban.sh`**：
   - 默认 `AUTOBAN_ENABLED=0` → **只告警不封禁**（彻底防自锁）
   - 支持 **CIDR 白名单** `/etc/supply-chain-proxy-allowlist`
   - 私有/回环地址、当前活跃 SSH/代理连接一律不封
   - 需要恢复封禁时：`AUTOBAN_ENABLED=1`（建议先观察日志一周）
3. **fail2ban ignoreip 扩容**：加入 120.229/120.235/111.55/223.104/27.38/163.125/183.11/14.112 等动态网段，避免 fail2ban 同样锁死自己
4. 脚本与白名单纳入仓库：`scripts/proxy-autoban.sh`、`deploy/vps/proxy-allowlist.conf`

## 四、应急通道（重要）
IPv6 SSH 不受该脚本影响，是可靠的**备用入口**：
```bash
ssh -6 -i ~/.ssh/supply_chain_vps_a root@2400:f880:1d:1d3a:835b:dcdd:a1c5:45d3
```
若 IPv4 再次失联，先用 IPv6 进入，再执行：
```bash
ufw status numbered | grep "DENY IN"     # 看是否有自己的 IP
# 删除误封（把 <num> 换成规则号）
ufw --force delete <num>
```

## 五、如何新增白名单 IP / 网段
```bash
vim /etc/supply-chain-proxy-allowlist      # 每行一个 IP 或 CIDR，支持 # 注释
# 例：120.235.0.0/16
```
新脚本会自动读取，无需重启服务（cron 每 5 分钟执行时生效）。

## 六、验证结果
- IPv4 SSH 22 / 2222：✅ 恢复
- IPv6 SSH：✅ 正常
- ufw DENY 规则：31 条误封已清除（仅剩 1 条历史规则）
- 白名单判定测试：自有网段 → 允许；未知 IP → 仅告警
- fail2ban：ignoreip 已含 8 个动态网段
