# Demo Video Script（演示视频脚本）

目标：3-4 分钟，向客户/投资人展示供应链金融 SaaS + Solana 链上存证的完整
工作流。节奏：开场 15s，四个核心场景各 40-50s，收尾 10s。

## 分镜总览

| # | 场景 | 建议时长 |
| --- | --- | --- |
| 1 | 系统概览 | 15s |
| 2 | 用户移动端上传单据 | 45s |
| 3 | 链上存证（哈希/签名/上链） | 40s |
| 4 | 管理端 PC 审核与链上确认 | 45s |
| 5 | 贸易订单全流程 | 50s |
| 6 | 数据看板与监控 | 30s |
| 7 | 风控：违约与保险赔付 | 30s |
| 8 | 收尾 | 10s |

## 1. 系统概览（15s）

画面：打开 `demo.html` 顶部三端架构图（用户端移动 / Solana 链 / 管理端 PC），
依次高亮三个卡片。

中文旁白：
> 这是一套面向国际贸易供应链的数字化系统：用户端拍照上传单据，Solana
> 链上完成哈希存证，管理端 PC 审核并确认，全程可追溯、可审计。

English voice-over:
> This is a digital supply-chain platform for international trade: documents
> are uploaded from mobile, hashed and attested on Solana, then reviewed and
> confirmed on the PC admin console - fully traceable and auditable.

## 2. 用户移动端上传单据（45s）

画面：手机 mock 内点"点击选择或拍照"，选择一张单据图片；填写贸易订单 ID
与单据编号；点击"上传并签名上链"。

中文旁白：
> 贸易方在手机端拍摄或选择单据，比如提单或发票。填写订单号和单据编号后，
> 一键发起上传。系统会在本地计算文件哈希，保证内容指纹唯一。

English voice-over:
> A trade party captures or selects a document such as a bill of lading or
> invoice on mobile, enters the trade ID and document number, then starts the
> upload. The system computes a local SHA-256 fingerprint to guarantee content
> integrity.

操作提示：演示前准备一张真实感单据图片；上传后暂停 1s 展示"计算哈希"进度。

## 3. 链上存证（40s）

画面：进度步骤 2/3 高亮"钱包签名"和"提交链上交易"；链上日志逐行出现
交易签名、Slot；用户状态变为 PENDING。

中文旁白：
> 钱包完成签名后，交易提交到 Solana，生成不可篡改的交易签名与区块号。
> 单据哈希、上传者钱包、时间戳一起写入链上存证账户。

English voice-over:
> After the wallet signs, the transaction is submitted to Solana and gets a
> tamper-proof signature and slot. The document hash, owner wallet, and
> timestamp are written to an on-chain attestation account.

操作提示：切换到"链上存证记录"面板，滚动展示日志；可点开单据详情 JSON。

## 4. 管理端 PC 审核（45s）

画面：管理后台"待审核"列表出现该单据（缩略图、哈希、交易签名）；点击
"查看"放大图片；点击"审核通过"；状态变为 ON-CHAIN；右侧用户端状态同步更新。

中文旁白：
> 管理端实时收到待审核单据，查看图片与哈希，二次确认后审核通过。链上
> 存证状态更新为 ON-CHAIN，用户端同步看到确认结果，流程形成闭环。

English voice-over:
> The admin console receives the pending document in real time, inspects the
> image and hash, then approves with a confirmation dialog. The chain status
> updates to ON-CHAIN and the user sees the result instantly - the loop closes.

操作提示：演示批量审核时，先勾选多条 PENDING 单据，点"批量通过"，展示
批量更新与审计记录。

## 5. 贸易订单全流程（50s）

画面：切换到前端订单页：创建订单（金额、30/60/90/120 天账期、卖方钱包）→
预构建交易并签名 → 管理员拨款 FUNDED → 推进物流状态到 DELIVERED →
释放托管进入还款期 REPAYING → 还款 SETTLED；展示还款倒计时与费用分配。

中文旁白：
> 订单侧覆盖完整生命周期：创建订单时计算 30% 首付与 70% 池垫付；管理员
> 拨款后随物流推进状态；交付后进入还款期，页面显示还款倒计时；还款完成
> 后费用按平台、返利与 LP 分红分配，订单结清。

English voice-over:
> The trade flow covers the full lifecycle: creating a deal calculates a 30%
> down payment and 70% pool funding; after funding, logistics states advance;
> delivery enters the repayment window with a live countdown; repayment
> distributes fees to platform, rebates, and LP dividends, then settles.

操作提示：用预置的演示订单快速点击各状态按钮；还款倒计时卡点展示
"即将到期"警示。

## 6. 数据看板与监控（30s）

画面：资金池看板：Pool Size、NAV、30/70 仓位、实时 APR；资产趋势图；
流动性/利用率双轴图；indexer 同步状态。

中文旁白：
> 数据看板实时展示资金池规模、净值、仓位比例与年化收益，并用时间序列
> 呈现资产与利用率变化。监控大盘覆盖订单状态分布、上传成功率与延迟。

English voice-over:
> The dashboard shows pool size, NAV, position splits, and live APR, with
> time-series charts for assets and utilization. The monitoring stack covers
> order status distribution, upload success rate, and latency.

## 7. 风控：违约与保险赔付（30s）

画面：订单状态为 REPAYING 且超期，展示"即将到期/已逾期"；管理员触发
"标记违约"；链上日志显示 30% 抵押清算、保险基金赔付；订单 DEFAULTED。

中文旁白：
> 若买方超期未还，管理员可触发违约清算：30% 抵押金被清算，保险基金
> 按规则赔付，订单进入 DEFAULTED，并向风控系统发送 Webhook 通知。

English voice-over:
> If the buyer misses repayment, an admin can trigger default: the 30% down
> payment is liquidated, the insurance fund pays out per policy, the deal
> moves to DEFAULTED, and a webhook notifies the risk system.

## 8. 收尾（10s）

画面：回到系统概览图，Logo 与 Slogan。

中文旁白：
> 从单据上链到订单结清，供应链金融的每一步都可信、可查、可审计。

English voice-over:
> From document attestation to deal settlement, every step of supply-chain
> finance is trusted, verifiable, and auditable.

## 录制建议

- 分辨率 1920x1080，浏览器缩放 100%，关闭通知弹窗。
- 提前用 `scripts/health-check.sh` 确认服务健康，本地环境可用
  `bash scripts/smoke-e2e.sh` 做一次全链路预热。
- 敏感信息（真实钱包、交易密钥）演示时打码或使用测试数据。
- 每个场景之间加 0.5s 转场；关键数据（哈希、交易签名、Slot）停留 1.5s。
