# 安全评审 2026-08-24（平台上线前加固）

> 评审范围：生产源站暴露面、防火墙有效性、服务运行安全、外部可达性验证。
> 结论：主平台防护良好；本次修复 1 项源站端口暴露，另有 3 项需业务决策。

## 一、本次已修复

### 1. Docker 发布端口绕过 ufw（已修复并持久化）
- **问题**：ufw 只作用于 INPUT 链，Docker 发布端口走 FORWARD/DNAT 链，ufw 规则对容器端口实际无效。
  此前 `DOCKER-USER` 只限制了 80/443（仅 Cloudflare 网段），其余 Docker 发布端口（如 escrow 前端 8080）
  实际对公网开放、且为明文 HTTP，与 ufw 显示状态相反。
- **修复**：`scripts/supply-chain-cf-harden.sh` 增加
  - 显式 DROP 外部访问 8080；
  - 兜底 DROP：外部来源访问**任何**其它 Docker 发布端口一律拒绝（最小权限，新增公开端口需显式放行）；
  - IPv4/IPv6 同步生效。
- **持久化**：systemd 服务 + `monitor-vps.sh` 自愈逻辑会重建该规则（docker 重启后不丢失）。
- **验证**：主站 `supplychain.de5.net` 与 sslip.io 反代路由均正常，8080 外部不可达。

### 2. ufw 规则清理
- 删除误导性的 `8080/tcp ALLOW Anywhere`（Docker 端口不受 ufw 控制，保留只会造成"已封禁"的假象）。

## 二、外部可达性实测（香港/日本/新加坡探测点）

| 端口 | 服务 | 可达性 | 说明 |
|---|---|---|---|
| 80/443 | nginx 源站 | 仅 Cloudflare 网段 | 回源已收紧，主站经 CF 正常 |
| 8080 | escrow 前端 | ❌ 已封禁 | 本次修复；仅保留 nginx 443 反代入口 |
| 4173 | PrivacyPool USDT demo | ⚠️ 公网可达 | 见下方"待决策" |
| 8545 | 私链 Hardhat JSON-RPC | ❌ 已封禁 | ufw 仅放行内网/Docker 网段 |
| 22 | SSH | key-only + fail2ban | 1377 次失败尝试 / 25 个 IP 已封禁 |

## 三、主平台防护现状（已确认良好）

- 源站 80/443 仅接受 Cloudflare 网段（DOCKER-USER）
- Cloudflare：安全级别 High、Browser Check、Bot Fight Mode、WAF 托管规则、登录/注册边缘限速、TLS 1.2+、HSTS
- 应用层：Turnstile 人机验证、TOTP、全局限速（120/min）、CSP（nonce + strict-dynamic + 上报）、
  登录失败审计、敏感操作限流
- 后端容器以非 root 用户运行、非特权模式
- SSH：禁用密码登录、root 仅密钥、MaxAuthTries=3、fail2ban
- 证书：两域名证书有效期正常（至 2026-11-09），certbot 自动续期
- 密钥文件权限：`.env.app` 600 root，未入库

## 四、待业务决策

1. **GitHub 仓库为 Public**：仓库含 VPS IP、完整 nginx 配置、部署拓扑文档，对金融平台属
   信息暴露。建议**转为 Private**（或至少移除部署拓扑类文件）。
2. **PrivacyPool USDT demo（4173）**：公网可达、以 root 运行、管理 Token 明文存于 644 权限的
   systemd unit。建议：非 root 运行 + unit 文件 chmod 600 + 如非必要收紧暴露。
3. **私链 RPC 鉴权**：Hardhat 节点当前无鉴权（含 hardhat_ 系列管理方法），现靠防火墙内网隔离；
   若未来需对外提供 RPC，必须先加方法白名单/鉴权网关。
