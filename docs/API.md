# 接口文档

本文档对应本地默认端口，生产环境替换为网关域名即可。

| 服务 | 本地端口 | 说明 |
| --- | --- | --- |
| 主后端 | `3001` | 认证、文件、审核、审计、管理统计 |
| indexer-service | `3003` | 链上同步状态 |
| trade-service | `3004` | 贸易订单预构建与确认 |
| pool-service | `3005` | 资金池总览、LP 提款与赎回 |
| 前端 | `3100` | Next.js 管理台 |

## 通用约定

- 鉴权：登录/注册后服务端设置 httpOnly Cookie（`access_token` 15 分钟、
  `refresh_token` 30 天自动轮换）；前端浏览器请求自动携带 Cookie。
  脚本/CLI 客户端也可使用响应中的 `accessToken` 通过
  `Authorization: Bearer <token>` 调用。
- 金额：链上金额一律使用字符串，单位是 USDC 原始单位（6 位小数）。
  例如 `1 USDC = "1000000"`。
- 错误响应统一为：

```json
{
  "statusCode": 400,
  "message": "错误原因",
  "error": "Bad Request",
  "requestId": "uuid",
  "timestamp": "2026-08-02T00:00:00.000Z"
}
```

- 写接口（POST/PATCH/DELETE）会校验 `Origin`：非白名单来源返回
  `403 跨域请求被拒绝`。生产环境必须配置 `ALLOWED_ORIGIN`。
- 状态码：`400` 参数错误、`401` 未登录/凭证过期、`403` 无权限、
  `404` 不存在、`409` 冲突、`429` 限流/锁定、`500` 服务错误。

## 1. 认证（主后端 3001）

### POST /api/auth/register

公开注册，角色固定为 `USER`，不能注册管理员。

```json
{
  "name": "张三",
  "email": "user@example.com",
  "password": "secret123",
  "wallet": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
}
```

返回：

```json
{
  "accessToken": "eyJ...",
  "user": { "id": "u1", "email": "user@example.com", "role": "USER" },
  "mustChangePassword": false
}
```

同时设置 `access_token` / `refresh_token` 两个 httpOnly Cookie。

### POST /api/auth/login

```json
{ "email": "user@example.com", "password": "secret123" }
```

返回结构与注册一致，并设置登录 Cookie。限流与防暴破：单接口 20 次/分钟；同一邮箱 5 次失败锁定
15 分钟；同一 IP 20 次失败锁定 15 分钟。

### POST /api/auth/refresh

使用 `refresh_token` Cookie 轮换会话，成功后签发新的 access/refresh Cookie；
旧 refresh token 一旦复用会撤销该用户全部会话。前端在收到 `401` 时自动调用一次。

### POST /api/auth/logout

撤销当前 refresh token 并清除 Cookie。

### POST /api/auth/change-password

```json
{ "currentPassword": "old", "newPassword": "new-password" }
```

管理员使用初始密码登录时 `mustChangePassword=true`，改密前除
`me` / `change-password` / `logout` 外所有受保护接口返回 `403 请先修改初始密码`。

### GET /api/auth/me

返回当前登录用户信息。

### PATCH /api/auth/wallet

```json
{ "wallet": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }
```

绑定/更换钱包；地址已被其他用户绑定时返回 `409`。

## 2. 文件（主后端 3001）

### POST /api/files

`multipart/form-data`，字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | 文件，最大 50MB，白名单：pdf/png/jpg/jpeg/doc/docx |
| `tradeId` | 否 | 关联订单 ID；填写后校验上传者必须是订单买方或卖方 |
| `description` | 否 | 描述，最长 500 字符 |

安全规则：扩展名 + 魔数双重校验；同用户同哈希文件不可重复上传；
每日配额默认 200 个（`MAX_UPLOADS_PER_DAY`），超限返回 `429`；
配置 `CLAMAV_HOST`（clamd TCP）或 `SCAN_URL`（HTTP JSON）后先杀毒后落库；
PNG/JPEG 上传时自动去除 EXIF/GPS 元数据。

返回 `FileRecord`：

```json
{
  "id": "cmsbw...",
  "filename": "invoice.pdf",
  "size": 1024,
  "mimeType": "application/pdf",
  "hash": "64位sha256",
  "status": "PENDING",
  "tradeId": "42",
  "description": null,
  "uploaderId": "u1",
  "createdAt": "2026-08-02T00:00:00.000Z"
}
```

### GET /api/files?page=1&limit=10&status=PENDING

分页列表，`limit` 最大 100。管理员可见全部，普通用户只能看自己的文件。
列表有 15 秒 Redis 缓存。

### GET /api/files/:id

文件详情。

### GET /api/files/:id/content

流式返回文件内容（`Content-Disposition: inline`），权限同详情。

### PATCH /api/files/:id（管理员）

审核文件，必须显式二次确认：

```json
{ "status": "APPROVED", "confirm": true, "remark": "通过" }
```

`confirm` 缺失或为 `false` 时返回 `400`。

### DELETE /api/files/:id?confirm=true

删除文件，必须携带 `confirm=true`。已存证（有 `txSignature`）的文件
不可删除，返回 `403`。

### POST /api/files/:id/attest

预构建存证交易：

```json
{ "walletAddress": "9xQe...", "tradeId": "42" }
```

返回 `{ transaction, blockhash, documentPda, message }`。

### POST /api/files/:id/attest/confirm

```json
{ "txSignature": "4xYJ...", "documentPda": "5xYJ..." }
```

校验链上 `attest_document` 指令后回写存证信息。

## 3. 管理（主后端 3001）

### GET /api/admin/stats（管理员）

返回用户/文件/订单/提款按状态统计、24 小时审计日志数、待审核文件数。

### GET /api/admin/audit-logs?page=1&limit=20&action=FILE_APPROVED&targetType=FILE

审计日志分页，`limit` 最大 100。

### GET /api/admin/audit-logs/export?limit=10000&action=&targetType=

导出审计日志 CSV（带 BOM，兼容 Excel），参数 `action` / `targetType` / `limit`，
默认最多 10000 条，按时间升序。

## 4. 贸易订单（trade-service 3004）

订单状态：`PENDING → FUNDED → IN_TRANSIT → CUSTOMS_CLEAR →
DELIVERED → REPAYING → SETTLED`，违约进入 `DEFAULTED`。

### POST /api/trades

```json
{
  "buyerWallet": "9xQe...",
  "sellerWallet": "8xQe...",
  "amount": "1000000000",
  "tenor": "30",
  "logisticsHash": "0xabc"
}
```

`tenor` 只允许 `30/60/90/120`。返回：

```json
{
  "tradeId": "1722537600000",
  "transaction": "base64交易",
  "blockhash": "4xYJ...",
  "dealPda": "5xYJ...",
  "downPayment": "300000000",
  "poolPortion": "700000000",
  "duplicate": false
}
```

前端用 `Transaction.from(Buffer.from(transaction, "base64"))` 签名上链。

### GET /api/trades

当前用户相关订单列表。

### GET /api/trades/admin（管理员）

全部订单列表。

### POST /api/trades/:tradeId/confirm

```json
{
  "buyerWallet": "9xQe...",
  "sellerWallet": "8xQe...",
  "amount": "1000000000",
  "tenor": "30",
  "txSignature": "4xYJ..."
}
```

校验链上 `create_deal` 指令后回写订单；并发重复提交由 Redis 锁拦截。

### POST /api/trades/:tradeId/fund（管理员）

```json
{ "adminWallet": "9xQe..." }
```

返回预构建的 `fund_deal` 交易。

### POST /api/trades/:tradeId/fund/confirm

```json
{ "txSignature": "4xYJ..." }
```

### POST /api/trades/:tradeId/advance（管理员）

推进物流状态：

```json
{ "targetStatus": "2", "adminWallet": "9xQe...", "txSignature": "可选" }
```

`targetStatus`：`2=InTransit, 3=CustomsClear, 4=Delivered`。

### POST /api/trades/:tradeId/advance/confirm

```json
{ "txSignature": "4xYJ...", "targetStatus": "2", "adminWallet": "9xQe..." }
```

### POST /api/trades/:tradeId/repay（买方）

买方还款预构建交易。

### POST /api/trades/:tradeId/repay/confirm

```json
{ "txSignature": "4xYJ..." }
```

### POST /api/trades/:tradeId/default（管理员）

```json
{ "adminWallet": "9xQe..." }
```

违约清算预构建交易。

### POST /api/trades/:tradeId/default/confirm

```json
{ "txSignature": "4xYJ..." }
```

### POST /api/trades/:tradeId/release（管理员）

交付确认后释放托管资金给卖方。

```json
{ "adminWallet": "9xQe..." }
```

### POST /api/trades/:tradeId/release/confirm

```json
{ "txSignature": "4xYJ..." }
```

## 5. 资金池（pool-service 3005）

### GET /api/pool/overview

公开总览：`nav/totalAssets/activeCapital/reserveFund/insuranceFund/
pendingDividends/utilizationBps/aprPct/totalDeals/activeDeals/
settledDeals/defaultedDeals/trend`。30 秒 Redis 缓存，按快照时间换 key。

### POST /api/lp/withdraw-request

```json
{ "lpWallet": "9xQe...", "amount": "500000000", "poolAddress": "7xYJ..." }
```

校验 7 天预告期，单笔上限默认 100 万 USDC。返回：

```json
{
  "queueId": "uuid",
  "status": "PENDING",
  "noticeDays": 7,
  "unlockAt": "2026-08-09T00:00:00.000Z"
}
```

### POST /api/lp/withdraw-request/:id/execute（管理员）

```json
{ "txSignature": "4xYJ...", "confirm": true }
```

仅 `READY` 状态可执行，必须 `confirm: true`。

### GET /api/lp/withdraw-requests（管理员）

全部提款请求（最近 200 条）。

### POST /api/lp/redeem

```json
{ "lpWallet": "9xQe...", "lpAmount": "5000" }
```

LP 链上赎回预构建交易。

### POST /api/lp/redeem/confirm

```json
{ "lpAmount": "5000", "txSignature": "4xYJ..." }
```

校验交易包含用户 LP/USDC ATA、资金池状态与 LP mint 后才回写记录。

## 6. 索引器（indexer-service 3003）

### GET /api/indexer/status

```json
{
  "service": "indexer-service",
  "queue": { "wait": 0, "active": 0, "delayed": 0, "failed": 0 },
  "lastPoolSnapshotAt": "2026-08-02T15:00:00.000Z",
  "lastDealSyncedAt": "2026-08-02T13:35:55.000Z",
  "totalDeals": 13,
  "now": "2026-08-02T15:56:00.000Z"
}
```

## 7. 健康与指标

四个服务都提供：

- `GET /health`：服务与数据库状态。
- `GET /health/ready`：K8s readiness 探针，数据库不可用时返回 503。
- `GET /metrics`：Prometheus 指标。

## 链上指令（Anchor `trade-finance`）

| 指令 | 说明 |
| --- | --- |
| `initialize_pool(platform_wallet)` | 初始化资金池管理员 |
| `get_pool_info` | 查询资金池状态 |
| `create_deal(id, seller, amount, tenor_days)` | 创建订单，锁定 30% 首付 |
| `fund_deal(id)` | 管理员拨款 70% |
| `advance_deal(id, target_status)` | 推进物流状态 |
| `release_to_seller(id)` | 释放托管给卖方 |
| `repay_deal(id)` | 还款并分配费用（平台 50%/返利 10%/LP 分红 40%） |
| `default_deal(id)` | 违约清算 + 保险赔付 |
| `deposit_pool(amount)` | LP 存入稳定币 |
| `redeem_lp(amount)` | LP 赎回 |
| `attest_document(trade_id, file_hash, uri)` | 单据哈希存证 |
| `refresh_nav` | 刷新 NAV |

Swagger 页面：主后端 `http://localhost:3001/api-docs`、
trade-service `http://localhost:3004/docs`、
pool-service `http://localhost:3005/docs`。
