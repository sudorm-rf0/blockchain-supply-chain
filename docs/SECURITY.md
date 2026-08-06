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
