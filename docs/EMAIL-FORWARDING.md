# 企业邮箱转发配置（Cloudflare Email Routing → 139 邮箱）

> 状态更新：2026-08-21
> 域名：`supplychain.de5.net`（Cloudflare Zone: 6a970137e4b9e350eb89b188b95d03cf）

## 当前进度（2026-08-21 完成）

- [x] **Email Routing 已启用**（API 启用 → enabled=true, status=ready）
- [x] **DNS 记录就绪**（Cloudflare 自动添加，公网已生效：MX 51/13/26、SPF、DKIM、DMARC）
- [x] **目标地址已添加并验证**：`xrf0521@outlook.com`
- [x] **转发规则已建**（均为 enabled）：
  - `info@supplychain.de5.net` → xrf0521@outlook.com
  - `1@supplychain.de5.net` → xrf0521@outlook.com
- [ ] **Catch-all 未开**（token 无账号级权限；控制台一键开启，见下）
- [ ] 实收验证（从任意邮箱发信到 info@supplychain.de5.net）

## 待添加 DNS 记录（Cloudflare → DNS → Records，类型/名称/内容/优先级）

| 类型 | 名称 | 内容 | 优先级 | TTL |
|------|------|------|--------|-----|
| MX | `supplychain.de5.net` | `route1.mx.cloudflare.net.` | 51 | Auto |
| MX | `supplychain.de5.net` | `route2.mx.cloudflare.net.` | 13 | Auto |
| MX | `supplychain.de5.net` | `route3.mx.cloudflare.net.` | 26 | Auto |
| TXT | `supplychain.de5.net` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | - | Auto |
| TXT | `cf2024-1._domainkey.supplychain.de5.net` | `v=DKIM1; h=sha256; k=rsa; p=<cf2024-1 公钥>` | - | Auto |

> DKIM 公钥完整值：调用 `GET /zones/{zone}/email/routing/dns` 获取（或 Cloudflare 控制台 Email Routing → 发送域名 页面复制）。

## Cloudflare 控制台操作（若手动配置）

1. 打开 https://dash.cloudflare.com → 选择 `supplychain.de5.net` → 左侧 **Email → Email Routing**
2. 若显示未启用，点击 **启用**（当前 API 已启用）
3. **Email Routing → Settings → 目标地址**：添加 139 邮箱地址 → 去 139 邮箱点验证邮件
4. **Email Routing → Routing rules**：创建规则
   - 方案一（推荐）：Catch-all → 转发到 139 邮箱
   - 方案二：指定地址如 `contact@supplychain.de5.net` / `info@supplychain.de5.net` → 139 邮箱
5. 按页面提示把上述 5 条 DNS 记录添加到 DNS 面板（Email Routing 页面有"添加记录"按钮）

## API 自动配置（需更高权限 token）

当前 `CLOUDFLARE_API_TOKEN` 仅有 zones 读取 + email routing enable 权限。
完成全自动配置需要 token 带：**Email Routing (Edit)** + **DNS (Edit)**，然后执行：

```bash
# 1) 添加 MX
curl -X POST https://api.cloudflare.com/client/v4/zones/<zone>/dns_records \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"MX","name":"supplychain.de5.net","content":"route1.mx.cloudflare.net.","priority":51,"ttl":1}'
# ... route2(13) route3(26) 同理

# 2) SPF + DKIM TXT
# 3) 创建目标地址
curl -X POST https://api.cloudflare.com/client/v4/accounts/<account>/email/routing/addresses \
  -d '{"email":"<139邮箱地址>"}'
# 4) 创建 catch-all 规则
curl -X POST https://api.cloudflare.com/client/v4/zones/<zone>/email/routing/rules \
  -d '{"matchers":[{"type":"all"}],"actions":[{"type":"forward","value":["<139邮箱地址>"]}],"enabled":true}'
```

## 开启 Catch-all（可选，30 秒）

Cloudflare 控制台 → `supplychain.de5.net` → Email → Email Routing → **Routing rules** → **Catch-all** 右侧 Edit → 改为 **Send to** `xrf0521@outlook.com` → Save。
开启后 `任意@supplychain.de5.net` 都会转发到 outlook。

## 备注

- Email Routing 仅处理**收信转发**；如需以该域名**发信**（SMTP），需另配 Resend/Mailgun/SES 等（并在 DNS 加对应 SPF/DKIM）。
- 139 邮箱为中国移动邮箱，需用户提供完整地址（如 `手机号@139.com`）。
