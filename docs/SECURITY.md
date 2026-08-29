# 安全与依赖策略

## 漏洞报告

请通过 GitHub Security Advisory 或仓库 Issues 报告；涉及资金/越权的漏洞
请先私信维护者，不要在公开渠道披露细节。

## 依赖审计

- CI 以 `pnpm audit --prod --audit-level critical` 作为门槛。
- 本地审计：`pnpm audit --prod --registry https://registry.npmjs.org`
- SBOM：`bash scripts/generate-sbom.sh`

## 已知供应链残余

- `bigint-buffer@1.1.5`（GHSA-3gc7-fjrx-p6mg）：来自
  `@solana/spl-token -> @solana/buffer-layout-utils`，上游无补丁版本。
  目前无安全利用路径（由 Solana SDK 内部使用），已纳入审计报告，不在
  CI critical 门槛内阻断。

## 漏洞奖励计划（Bug Bounty）

本平台为供应链金融系统，欢迎安全研究者通过负责任披露（Responsible Disclosure）提交漏洞。

### 适用范围
- `supplychain.de5.net` 及关联子域（web / API）
- Solana 链上合约（`trade-finance` / `supply-chain`）
- Android APK 客户端

### 奖励范围与额度（USDC，链上支付）
| 级别 | 示例 | 奖励 |
|---|---|---|
| Critical | 合约资金可被窃取/增发、任意账户接管、签名绕过 | 1,000 – 5,000 |
| High | 越权访问他人数据、未授权资金操作、SSRF 利用 | 300 – 1,000 |
| Medium | 信息泄露、限速绕过、逻辑缺陷 | 50 – 300 |
| Low | 低危信息暴露、UI 缺陷 | 感谢致谢（酌情 10 – 50） |

### 规则
- 首次报告有效漏洞者优先；同一漏洞多人报告时奖励首位。
- 禁止：破坏性测试（删除/篡改生产数据）、DoS 攻击、社会工程、对第三方攻击、公开披露未修复漏洞。
- 允许在 devnet 上进行任意合约测试；主网测试请先联系维护者。
- 提交方式：GitHub Security Advisory（私有报告）或邮件至维护者；请勿在公开渠道泄露细节。

### 非奖励范围
- 已修复项（见 `docs/SECURITY-REVIEW-*.md`）、需物理接触/社会工程、已公开已知问题、依赖组件自身漏洞（CVE 上报上游）。
