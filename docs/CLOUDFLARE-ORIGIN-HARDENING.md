# Cloudflare 源站硬化（Origin Hardening）执行记录

> 执行日期：2026-08-17　对象：VPS-A（103.39.79.7 / VM120013）　方式：方案 A（源站 80/443 白名单 Cloudflare 网段）

## 一、背景与结论

原任务假设 supply-chain-cf-relay 是 cloudflared 隧道，实测**不是**（它是 Cloudflare 告警 Webhook → Resend → 邮件转发器）。
VPS 上不存在任何 cloudflared 隧道，Web 流量为 Cloudflare 橙云代理 → **直连源站 103.39.79.7:443**。
经用户确认，采用**方案 A**：把源站 80/443 仅放行给 Cloudflare 官方网段，其余来源 DROP，从而：
- 攻击者无法绕过 Cloudflare 的 WAF/限速/Turnstile 直连源站；
- 源站 IP 虽仍可被探测到，但非 Cloudflare 来源一律无法访问 80/443。

## 二、VPS 侧已执行的改动

| 项 | 改动 | 位置 |
|---|---|---|
| 防火墙 | DOCKER-USER 链：仅放行 Cloudflare 官方网段（v4 15 段 + v6 7 段）访问 80/443，其余 DROP | iptables / ip6tables |
| ufw | 删除公网 80/443 放行（v4+v6）；新增 22/tcp ALLOW from 120.229.163.11；其余规则不动 | /etc/ufw |
| nginx | 新增 set_real_ip_from <Cloudflare 全部网段>; + real_ip_header CF-Connecting-IP;，reload（未重启容器） | /opt/supply-chain/deploy/vps/nginx.conf |
| 持久化 | systemd 单元 supply-chain-cf-harden.service（oneshot，After=docker）开机/重启 docker 后自动重建 DOCKER-USER 规则 | /etc/systemd/system/ + /usr/local/bin/supply-chain-cf-harden.sh |
| 备份 | iptables.bak / ip6tables.bak / nginx.conf.bak.<ts> / ufw-status-<ts>.bak / docker-inspect.bak.<ts> / iptables.after | /root/ |

要点：
- 规则只作用于**公网网卡 ens18**（-i ens18），不影响 docker 桥内网互访与 WireGuard VPN 内访问；
- Cloudflare 网段来源：https://www.cloudflare.com/ips-v4 与 ips-v6（已核验观测到的回源 IP 全部在网段内）；
- 容器均未停止/重建，supply-chain-nginx 仅 reload。

## 三、验证结果（2026-08-17）

| 项 | 结果 |
|---|---|
| SSH（root，密钥） | 可达 |
| 经 Cloudflare 访问 https://supplychain.de5.net | 307 → /dashboard；/health 200 |
| 直连源站 103.39.79.7:443 | 拒绝（超时，DROP） |
| 直连源站 103.39.79.7:80 | 拒绝（超时，DROP） |
| nginx real_ip | access log 首字段已变为 CF-Connecting-IP 真实访客 IP |
| supply-chain 容器 | 全部 Up / healthy，未重启 |
| systemd 持久化单元 | enabled + active（幂等重建规则） |

## 四、Cloudflare 侧待办清单（需在 Cloudflare 控制台执行/确认）

> VPS 无 CF_API_TOKEN / CF_ZONE_ID，未调用 API。以下均需人工在 Cloudflare 仪表盘点选。

### DNS
- [ ] 域名 supplychain.de5.net：确认 A/AAAA 记录为**橙色云（Proxied）**状态，且源站 IP 指向 103.39.79.7（只有 A，无 AAAA 亦可）
- [ ] 确认无灰色云（DNS only）记录直接暴露源站 IP；如有，改为橙色云
- [ ] 开启 DNSSEC（SSL/TLS → 边缘证书 → DNSSEC；按提示在域名注册商处添加 DS 记录）

### SSL/TLS
- [ ] SSL/TLS → 概述 → 加密模式：**Full (strict)**（当前源站为 Let's Encrypt 有效证书）
- [ ] 边缘证书：HSTS 已开（max-age=31536000; includeSubDomains），确认保持

### WAF
- [ ] 安全性 → WAF → 托管规则：部署 **Cloudflare Managed Ruleset** + **OWASP Core Ruleset**，初始设置为 **Log（观察）模式**，观察 1-3 天确认无误伤后再切 Block
- [ ] 安全性 → 设置：安全级别 **High**、Browser Integrity Check **开**、Bot Fight Mode **开**（若影响正常 API 再按需关闭）

### 速率限制
- [ ] 安全性 → 速率限制：/api/auth/login 与 /api/auth/register 每 10 秒超 4 次 → Block 10 秒（叠加后端 throttle 与 Turnstile）
- [ ] 注意：**不要对 /api/* 启用托管质询**（fetch/XHR 无法自动过质询，会导致前端报"网络连接失败"）

### 缓存规则
- [ ] 缓存 → Cache Rules：starts_with(uri.path, "/_next/static/") → Cache Everything，Edge TTL 1 个月（30 天）
- [ ] 图片/字体等静态资源缓存 1 个月
- [ ] /api/* 与交易相关接口 → **Bypass**（不缓存）

## 五、回滚命令（如需）

```bash
# 1) 恢复 iptables（改动前快照）
iptables-restore < /root/iptables.bak
ip6tables-restore < /root/ip6tables.bak

# 2) 恢复 ufw 公网 80/443 放行（如已删除）
ufw allow 80/tcp
ufw allow 443/tcp

# 3) 恢复 nginx 配置
cp /root/nginx.conf.bak.<ts> /opt/supply-chain/deploy/vps/nginx.conf
docker exec supply-chain-nginx nginx -t && docker exec supply-chain-nginx nginx -s reload

# 4) 停用持久化单元
systemctl disable --now supply-chain-cf-harden.service

# 5) 应急（不推荐，仅紧急时）
ufw disable
```

## 六、遗留暴露面（本次未处理，待用户决策）

- 8080/tcp：usd-usdt-escrow-frontend 公网开放（ufw allow 8080）——若它也走 Cloudflare，建议同样收口
- 44300/tcp（xray reality）、32592/udp（wireguard）、49189/tcp（wg-onetime-phone）：主动使用的代理端口，仍暴露源站 IP；可用固定对端 IP 白名单或 cloudflared access tcp 隐藏（需用户提供对端 IP / 选择方案）
- nginx 103-39-79-7.sslip.io 虚拟主机：直连源站 IP 的 443 已被 DOCKER-USER 拒绝（非 CF 来源），但该域名仍会解析到源站；如需彻底移除可删该 server 块

## 七、附加安全优化（2026-08-17 同批次完成）

| 项 | 内容 |
|---|---|
| fail2ban | sshd bantime 1h → 24h（SSH 仅密钥登录，无正常用户会被误伤）；配置备份 /root/fail2ban-jail.local.bak.* |
| 日志轮转 | 新增 /etc/logrotate.d/supply-chain：/var/log/supply-chain-*.log 每日轮转、保留 14 天、压缩 |
| Docker 清理 | docker builder prune -af 释放构建缓存 38.75GB；磁盘使用率 75% → 27%（56G → 21G） |
| 监控自愈 | monitor-vps.sh 第 6 节：每 5 分钟检测 DOCKER-USER 443 DROP 规则，缺失时自动重建（防 docker 重启后规则丢失） |
| 未动的项 | 8080（escrow 直连前端，非 Cloudflare）、44300/32592/49189（主动使用的代理端口）、8545（仅 172.16/12 内网段）——均保持现状以免影响正常使用 |

### 验证补充（2026-08-17）
- 经 tcpdump 实测：公网来源（120.229.163.11）直连 103.39.79.7:443 的 SYN 被静默丢弃（无 SYN-ACK）——源站收紧对公网真实生效
- 经 Cloudflare 访问 /health 200 正常；SSH 正常
- 8080 本机验证 200（防火墙未对其设限）；外网端到端验证受本机代理干扰，未能独立复核，见遗留项
