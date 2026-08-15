# 全链路测试与审计报告（2026-08-15）

> 范围：前端测试 + 后端测试 + 业务衔接契约 + 生产部署实测 + 六领域静态审计（前端/后端认证安全/后端业务逻辑/前后端契约/合约与部署配置/测试质量）。
> 方法：运行全部既有测试套件（vitest/jest/lint/typecheck/依赖审计）、生产只读冒烟（安全头/健康/未授权访问）、6 个并行审计智能体静态分析（102 项发现）、关键发现人工复核实锤。
> 结论：**未发现可被外部直接利用导致资金损失的 critical 级漏洞**（合约层经多轮加固），但存在 **1 个 P0 级配置问题、3 个业务级 high（其中 1 个为 100% 必现的核心流程故障）、6+ 个安全 high/中危**。

---

## 一、测试执行结果

| 项目 | 结果 | 说明 |
|---|---|---|
| 后端 jest（29 套件 / 194 用例） | ✅ 全过 | 覆盖率阈值 stmts 35/branch 30/funcs 25/lines 35 达成 |
| 前端 vitest（12 文件 / 54 用例） | ✅ 全过 | 覆盖率 stmts 36.87%（阈值 15%）；**API 客户端层 0%** |
| lint（frontend/backend） | ✅ | eslint 无错误 |
| typecheck（frontend/backend/common） | ✅ | tsc --noEmit 0 错误 |
| pnpm audit（prod） | ⚠️ 2 high | 传递依赖 `image-size`（GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq），**无修复版本**，来自 @solana-mobile/wallet-adapter-mobile → react-native → metro 链条，非直接利用面 |
| e2e（Playwright） | ⚠️ 未执行 | 本机无 playwright browsers，且依赖 solana localnet（本机 arm64 无法运行 amd64 镜像）；**e2e 覆盖仅 1 个文件** |
| 生产冒烟 | ✅ | /health、/health/ready、/api/indexer/status、/api/pool/overview 均 200；安全头齐全（CSP nonce+strict-dynamic、HSTS、SAMEORIGIN）；未授权访问正确 401 |

---

## 二、P0 / 高严重度发现（已人工复核实锤）

### 🔴 P0-1 生产站点运行在 Solana devnet 测试链上
- **证据（生产实测）**：VPS `.env.app` 中 `SOLANA_RPC_URL=https://devnet.helius-rpc.com/...`，且 **`ALLOW_DEVNET_RPC_IN_PRODUCTION=true`** 显式绕过代码内审计守卫（`packages/backend/src/shared/env-check.ts` 明确禁止，注释为「P0-3：生产环境禁止连接 Solana devnet，防止公网站点跑在测试链」）。
- **影响**：`https://supplychain.de5.net` 上所有 USDC/LP 金额、托管、存证均为 devnet 测试资产，**无真实价值**。若对外宣称正式运行，属误导性上线；若为演示环境，需明确标注。
- **建议**：上线主网前移除该开关并切换 mainnet RPC/正式 mint；或对外明确标注「演示环境（devnet）」。

### 🔴 H-1 贸易订单 4 个链上确认端点 100% 返回 400 —— 拨款/还款/违约/释放确认流程必现故障
- **证据**：前端 `packages/frontend/src/lib/trades-api.ts:77-88,127-137,149-159,171-181` 的 `confirmFundTrade/confirmRepayTrade/confirmDefaultTrade/confirmReleaseTrade` 全部发送 `{ txSignature, confirm: true }`；后端这 4 个端点统一使用 `ConfirmSignatureDto`（仅声明 `txSignature`，`packages/backend/apps/trade-service/src/trades/dto/confirm-signature.dto.ts:5-10`），而 trade-service 全局 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`（`apps/trade-service/src/main.ts:21`）→ 未声明字段 `confirm` 直接 400。
- **影响**：管理员在订单详情页执行「拨款/还款/违约/释放」全部在 confirm 步骤失败（对比 `confirmTrade`/`confirmAdvanceTrade` 正常）。核心业务闭环不可用。**e2e 未覆盖此路径，故此前未被发现。**
- **修复**（二选一）：① 前端删除 4 处 `confirm: true`；② 后端 `ConfirmSignatureDto` 增加 `@IsOptional() @IsBoolean() confirm?: boolean`。建议统一后端声明式接受 + 补契约测试。

### 🔴 H-2 文件翻译接口 IDOR：任意登录用户可读取/篡改他人单据 OCR 内容
- **证据**：`packages/backend/src/files/files-translation.service.ts:91-125` 的 `translate()` 接收 `actorId` 但**从不使用**（无 `file.uploaderId !== actorId` 归属校验，对比同模块 `analyze()` 有校验）；`files.controller.ts:91-99` 仅挂 `AuthGuard`。攻击链闭合：公开接口 `GET /api/public/verify?hash=…`（`shared/public-verify.controller.ts:24-39`，`@SkipThrottle` 无限流）返回内部 `file.id`，配合文档副本计算 SHA-256 即可拿到目标 id。
- **影响**：供应链场景下交易对手间流转的发票/合同一旦被哈希查询，任意登录用户即可调翻译接口读取 OCR 全文（外发第三方翻译服务）并篡改翻译记录。
- **修复**：`translate()` 增加与 `analyze()` 一致的归属校验；公开核验接口移除 `id` 字段、缩减 `authResult` 披露。

### 🔴 H-3 生产反代后未启用 trust proxy：全站限流/登录防暴破退化为单 IP 桶
- **证据**：nginx 已透传 `X-Forwarded-For`（`deploy/vps/nginx.conf:83`），但 4 个服务 `main.ts` 均无 `app.set("trust proxy")` → `req.ip` 恒为反代容器 IP。登录失败计数 key=`login:fail:ip:${clientIp}`（`auth.service.ts:349-356`，`auth.controller.ts:34` 取 `request.ip`）。
- **影响**：任意 20 次失败登录即锁全站登录 15 分钟（攻击者可反复触发 DoS）；按 IP 的限流/防暴破设计全部失效。
- **修复**：按反代层数配置 `trust proxy`，使 `req.ip` 还原真实客户端 IP。

### 🔴 H-4 融资模块放款/还款零链上验证：借款人可零成本标记还清（纯 DB 状态翻转）
- **证据**：`packages/backend/src/financing/` 的 approve/repay 不校验链上证据（对比 trade 模块 confirm 均验交易指令+PDA），仅翻转 DB 状态。
- **影响**：融资记录可被伪造为已还清，账实不符；取决于融资是否对接真实资金池。
- **修复**：放款/还款接入链上证据校验（复用 trade 模块的 confirm 模式）。

### 🔴 H-5 管理员执行提款 executeWithdrawal 不校验链上证据即标记 EXECUTED
- **证据**：`apps/pool-service/src/pool/pool.service.ts` 提款执行路径直接置 EXECUTED，无链上 redeem 验证（对比 confirmRedeemLp 有）。
- **影响**：DB 显示已出金而链上实际未发生，或反之，对账失真。
- **修复**：执行前校验链上 redeem/转账证据。

### 🔴 H-6 生产模板默认超级管理员口令可构成完整接管链
- **证据**：`prisma/seed.ts:84` 默认 `"SuperAdmin123!"`（14 字符可通过生产长度守卫）；种子账号免邮箱码（`auth.service.ts:741-747`）；模板 `TURNSTILE_SECRET` 留空时 Turnstile 直接放行（`turnstile.service.ts:46-49`）。`infra/config/production.env.example:77-78` 明文提交默认值。
- **影响**：按模板部署且未改 `SUPER_ADMIN_PASSWORD` 的环境可被公开默认口令接管。**注意：实测生产 VPS 的 `.env.app` 已配置 TURNSTILE_SECRET 等，实际口令无法验证，风险主要针对模板部署者。**
- **修复**：生产强制显式设置强口令 + 首登改密需第二因素；模板删除默认口令。

### 🔴 H-7 trade-finance 合约无 PENDING 订单取消/退款路径
- **证据**：`packages/contracts/programs/trade-finance/src/lib.rs` create_deal 将 30% 首付转入托管；close_deal 仅允许 SETTLED/DEFAULTED 且余额为 0。
- **影响**：买方 30% 首付在订单长期 PENDING（卖方/管理员不推进）时可被永久锁定。
- **修复**：合约层增加 PENDING 取消 + 退款指令（需多签/治理审批）。

---

## 三、中危发现（摘要）

### 前端（medium ×6）
1. **换绑邮箱只验证新邮箱**（account/page.tsx:160-191 + auth.service.ts:691-705）——会话被窃取后可静默改绑邮箱 → 走忘记密码接管账号（账号劫持链，与 H-2 同链）。前端把验证码发往**新**邮箱、后端只核验新邮箱、无旧邮箱确认/密码。
2. **FileCompareDialog 无 sandbox 同源 blob iframe 渲染上传内容**（FileCompareDialog.tsx:45-49）——存储型 XSS 面（当前被服务端 magic-bytes + 响应 CSP sandbox 缓解）。
3. **金额经 IEEE-754 浮点转换放大 1e6**（trade/new、dashboard、financing）——>2^53 微单位精度丢失、.xx5 边界舍入错误；上链金额不应走浮点。
4. **上传校验可绕过**：相机入口直接调 onDrop 跳过 accept/maxSize（upload/page.tsx:291-301）。
5. **资金/权限敏感操作无二次确认**：角色变更（accounts 页 onValueChange 即 PATCH）、提现执行、融资还款单击即生效。
6. **登出不彻底**：内存态 store、钱包不断开（autoConnect）、多标签不同步，被踢后旧数据仍可见。
7. **Sidebar 渲染期读 window.location.search** → SSR/首帧水合不匹配（Sidebar.tsx:52-65）。
8. **批量审核选中项跨页/跨筛选残留**（admin/files）→ 可对不可见文件执行审批。

### 后端（medium ×7）
1. 按邮箱登录失败锁定可被用于对受害者账号 15 分钟 DoS（auth.service.ts:344-372）。
2. 邮箱 OTP devCode 只依赖 NODE_ENV 单一防线；非生产环境直接返回 OTP（email-verification.service.ts:122）。
3. Turnstile 未配置时静默跳过，deleteAccount 等敏感操作仅剩一道闸（turnstile.service.ts:46-49）。
4. 审计 CSV 导出公式注入（CSV injection）。
5. 监控指标 label 基数无界（csp-report + UUID 路径 → Prometheus 内存膨胀）。
6. 公开核验接口过度披露（id/OCR 字段/上传者姓名/无限流）。
7. 索引器 deal 同步 skip-behind 为读-改-写竞态，并发下 DB 状态可回退/跳级（sync-processor.service.ts）。
8. 文件版本自增无事务/唯一约束，supersededAt 先于 create 标记（files 版本竞态）。
9. LP_MINT 默认值等于 USDC_MINT（模板风险；生产已正确区分）。
10. confirm* 系列不校验交易签名者身份（依赖链上 check_authority）。
11. 违约触发无服务端门槛：FUNDED~DELIVERED 管理员可随时违约没收买方 30% 抵押（未到期订单应加二次确认/原因留痕/双人审批）。
12. createTrade 重复订单检测 findFirst 竞态，可双开同参数订单重复融资。

### 业务衔接（medium ×2 + low ×4）
1. 测试部署 nginx.http.conf 缺 /api/financing、/api/supply-chain、/api/email-verification、/api/meta、/api/public 反代路由 → 该模式注册/融资/核验全 404。
2. buildRedeemLp 响应缺 tradeId 与前端 BuiltTransactionResponse 类型不符。
3. sendEmailOtpCode 类型声明 ok 必填、后端无此字段；confirmRegisterProduct product 缺 txSignature/createdAt；FileRecord.path 后端永不返回（死字段）；POST /api/lp/withdraw-request 与 GET /api/admin/stats 无前端消费方（半成品状态机/死代码）。

### 合约/配置（medium ×5 + low）
1. k8s Ingress 缺多个 API 前缀路由（与 nginx.http.conf 同病）。
2. nginx API location 缺 Host/X-Forwarded 头（部分 location）。
3. .env.data 仍为 CHANGE_ME 占位（模板）；create-k8s-secrets.sh 弱默认值。
4. 违约/逾期计时从 created_at 起算压缩买方实际账期。
5. 集中度上限只按单笔不按买方。
6. 默认口令/README 公开默认凭据（并入 H-6）。

### 低危精选
- 软删账号 access token TTL 内仍有效；JWT 无 iss/aud/nbf、四服务共用 secret 无受众隔离；CORS 放行任意 localhost 端口；邀请码用 Math.random()；邮箱大小写不一致可注册近似重复邮箱；x-request-id 反射可致单请求 500；Swagger /api-docs 无条件暴露；TOTP 密钥由共享 JWT_SECRET 派生；审计日志 90 天物理删除无金融豁免；角色变更后 JWT role 最长残留 15 分钟；aprPct 语义误导（待分红占比非年化）；下载 blob URL 立即 revoke 兼容问题；上传 XHR 无 401 刷新重试；fetchSession 网络抖动误踢登录页；RepaymentCountdown 依赖客户端时钟。

---

## 四、测试质量缺口（详见附录 A）

- **前端 API 客户端层覆盖率 0%**：auth/files/pool/trades/financing/supply-chain/indexer/admin-api 及 types.ts 全部未测——正是本次发现的 H-1（confirm:true 契约断裂）这类问题产生的温床。
- **e2e 仅 1 文件**，未覆盖：融资申请/审批、风控 webhook、管理员文件审核、提款、供应链页面、多语言/主题、移动端、错误场景。
- 后端 194 用例全过但 branch 阈值仅 30%，大量分支（违约/部分还款/并发）未覆盖。
- H-1 属于「测试全部通过但核心流程必现故障」的典型——**契约测试缺失**。

---

## 五、修复优先级建议

| 优先级 | 项 | 工作量 |
|---|---|---|
| P0（立即） | ① devnet 开关：明确演示/上线定位，上线主网前移除 ALLOW_DEVNET_RPC_IN_PRODUCTION | 配置级 |
| P0（立即） | ② H-1 confirm:true 400 修复（删前端字段或后端 DTO 加可选字段）+ 契约测试 | 小 |
| P1（本周） | ③ H-2 翻译 IDOR 归属校验；公开核验接口收敛披露 | 小 |
| P1（本周） | ④ H-3 trust proxy 配置 | 小 |
| P1（本周） | ⑤ H-6 默认超管口令（模板+守卫） | 小 |
| P1 | ⑥ 换绑邮箱增加当前邮箱/密码校验（账号劫持链） | 中 |
| P1 | ⑦ FileCompareDialog iframe 加 sandbox 或改 pdf.js 渲染 | 小 |
| P2 | ⑧ 金额改十进制字符串解析；上传校验收紧；敏感操作二次确认 | 中 |
| P2 | ⑨ H-4/H-5 融资/提款链上证据校验 | 中 |
| P2 | ⑩ H-7 合约取消/退款路径（需审计+多签） | 大 |
| P3 | ⑪ 前端 API 层补测试（防契约断裂回归）；e2e 覆盖核心旅程 | 中 |
| P3 | ⑫ nginx.http.conf / k8s ingress 路由补齐；死代码清理 | 小 |

> 说明：生产 VPS 实测 RESEND_API_KEY/TURNSTILE_SECRET/ALLOWED_ORIGIN 均已配置，邮件/验证码链路在线可用；`.env`/密钥均未被 git 追踪，`.gitignore` 覆盖完整。

---

## 附录 A：测试质量详细发现

### A-1 核心业务模块零测试（后端，覆盖率报告之外）
以下模块**没有任何 spec 引用**，istanbul 覆盖率报告连 0% 都未计入（模块从未被测试加载）：
- `financing.service.ts`（177 行：turnstile 校验/发票归属/仅 APPROVED 可融资/折扣上限/approve-reject-repay 状态机）——融资全链路零测试
- `files-translation.service.ts`（150 行：MyMemory→Google gtx 双供应商回退、长文本分块、语言检测、verify 审批）——即本次发现 IDOR 的模块
- `files-analysis.service.ts`（310 行：tesseract OCR、风险评分校验）+ `ocr-fields.ts`
- `withdrawal-worker.service.ts`（cron 提升到期提款 PENDING→READY）——资金路径
- `redeem-lp.builder.ts`（链上赎回构建，仅 34.1% stmts / **0% fn / 0% br**）——资金路径
- `accounts.controller.ts` + `invite-codes.service.ts`（角色变更/提权、邀请码生成/核销）——准入与权限
- `turnstile.service.ts`、`email-verification.controller.ts`

### A-2 前端测试缺口
- 24 个页面仅 3 个有测试（dashboard 88.1% / admin/files 77.0% / user/upload 82.2%）；login、register、account、security、orders、trade/new、financing、admin/* 全部 0%
- lib/ 下 11 个 API 文件全部 0%（auth/files/financing/indexer/pool/supply-chain/trades/accounts/admin-api、api.ts、types.ts）——**H-1 契约断裂正是在这片无测试土壤中产生**
- 3 个页面测试全部 `vi.mock('@/lib/api')`，真实 URL/动词/载荷契约从未被执行
- `middleware.ts`（路由守卫）被显式 exclude 且无测试；多语言/主题组件 0%
- 弱断言：format.test 只断言 contains("2026")；status.test 只断言字面常量

### A-3 覆盖率门槛系统性失效机理
- **前端**：全局聚合阈值（stmts 15%），lib/ 0% 被平均掩盖
- **后端**：`jest.config.js` collectCoverageFrom 未开 `all: true` → **未被测试加载的模块不计入分母**（比 0% 更隐蔽）；branch 阈值 30% 低于实测 43.47%，资金路径分支（redeem-lp.builder br 0%）回退门禁无感
- **CI 与本地不一致**：CI 才带 `--coverage`，本地 `pnpm test` 永不触达门槛；e2e 作业无 `playwright install` 步骤、无 trace 上传、未起 indexer-service（dashboard 的 indexer 状态在 CI 必然显示无法连接）

### A-4 e2e 缺口（仅 3 用例）
覆盖：注册→邮箱验证→登录（OTP）→上传 v1/v2 → 管理员强制改密 → 订单详情 → TOTP 开启/登录。
**缺失**：融资申请/审批/还款、风控 webhook、管理员文件审核、提款管理、供应链注册、多语言/主题切换、移动端视口、网络失败/500 错误场景。
可靠性隐患：① seedAdmin 猜测种子密码且测试 2 会改掉种子密码（状态污染）；② 依赖 dev 验证码 toast（与 CI production 模式的隐式耦合）；③ 90s 等冷却慢且易抖。

### A-5 测试证据文档滞后
`docs/TEST-EVIDENCE-20260808.md:15-16` 记录后端 156/156、前端 50/50，与当前实测（194/54）不符；且未记录覆盖率数字（前端 stmts 36.87%、后端 40.41%）与「financing/翻译/OCR 零测试」现状——审计方按文档核对会得到过时结论。建议文档改为指向 CI 可复现命令（含 `--coverage` 输出），并补充「未覆盖模块清单」作为已知风险附录。
