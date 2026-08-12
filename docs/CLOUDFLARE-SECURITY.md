# Cloudflare 安全防护与优化配置

> 对应域名：`supplychain.de5.net`（Zone ID 见 Cloudflare 控制台 → 域名概览右侧）
> 适用：本系统（供应链金融平台）经 Cloudflare 代理部署在 VPS 上。

## 一、已在代码/部署层生效（无需 Cloudflare 配置）

| 项 | 位置 |
|---|---|
| HSTS（max-age 1 年，含子域） | `deploy/vps/nginx.conf` |
| X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy | `deploy/vps/nginx.conf` |
| 前端静态资源缓存（`/_next/static/*`，immutable 30 天） | `deploy/vps/nginx.conf` |
| CSP（放行 Turnstile、限后端域名） | `packages/frontend/src/middleware.ts` + `next.config.mjs` |
| 登录/注册人机验证 | Cloudflare Turnstile |
| 登录/注册接口限速 | 后端 throttle（`THROTTLE_LIMIT`）+ Cloudflare 边缘限速 |
| TOTP 两步验证、密码强度 | 后端 auth |

## 一·补充、Cloudflare 侧已通过 API 启用（2026-08-12）

| 项 | 配置 | 说明 |
|---|---|---|
| 速率限制 | `/api/auth/login` + `/api/auth/register` 每 10 秒超 4 次 → **封禁 10 秒** | 免费版参数受限（period/timeout 仅支持 10）；叠加 Turnstile + 后端限速 |

> ⚠️ **教训：不要对 API 路径（`/api/*`）启用托管质询**——fetch/XHR 无法自动通过质询，会导致登录/注册等接口 403、前端报"网络连接失败"。API 防护依赖 Turnstile + 限速 + 后端限速即可；托管质询仅适合导航类页面。

## 二、Cloudflare 侧防护（推荐全部开启）

### 方式 A：一键脚本（推荐，需带权限的 API Token）

```bash
# Token 权限：Zone → Settings/WAF/Rate Limit/Cache → Edit（资源：supplychain.de5.net）
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ZONE_ID=<zone-id> \
  bash scripts/configure-cloudflare-security.sh
```

脚本幂等，会配置：
1. 安全级别 **High**、Browser Integrity Check **开**
2. SSL 模式 **Full**、TLS 1.3 **开**、最低 TLS 1.2、Brotli 压缩
3. **HSTS**（1 年，含子域）
4. **Bot Fight Mode** 开启
5. **WAF 托管规则集**（Cloudflare Managed Ruleset）
6. **速率限制**：`/api/auth/*` 每 10 秒 4 次，超限封禁（免费版参数上限）
7. **缓存规则**：`/_next/static/*` 边缘缓存 30 天

权限不足时脚本会打印 `⚠️` 并给出手动路径，其余项照常配置。

### 方式 B：控制台手动（路径速查）

| 功能 | 控制台路径 | 建议值 |
|---|---|---|
| SSL/TLS | SSL/TLS → 概述 | 加密模式 **Full** |
| 边缘证书 HSTS | SSL/TLS → 边缘证书 → HSTS | 开启，max-age 31536000 |
| TLS 1.3 | SSL/TLS → 边缘证书 | 开启 |
| 安全级别 | 安全性 → 设置 | **高** |
| Browser Integrity Check | 安全性 → 设置 | 开启 |
| Bot Fight Mode | 安全性 → Bots | 开启 |
| WAF 托管规则 | 安全性 → WAF → 托管规则 | 部署 Cloudflare Managed Ruleset |
| 速率限制 | 安全性 → 速率限制 | login 20/min、register 10/min（block 15min） |
| 缓存规则 | 缓存 → Cache Rules | `starts_with(uri.path, "/_next/static/")` → Cache Everything，Edge TTL 30 天 |
| Under Attack Mode | 安全性 → 设置 | 攻击时临时一键开启 |

## 三、说明与边界

- **Bot Fight Mode / WAF 托管规则**对 `supplychain.de5.net` 全站生效，若发现误伤（如 API 正常请求被质询），可在 WAF 规则里为已通过 Turnstile 的请求加白名单。
- 本系统已内置多层防护（Turnstile + 后端限速 + TOTP），Cloudflare 侧作为第一道边缘防线。
- 升级/更换 Token 后重跑脚本即可（幂等，不会重复创建限速/缓存规则时可先手动删除旧规则）。
