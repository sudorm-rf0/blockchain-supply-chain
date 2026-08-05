# Solana RPC 压测报告

- 日期：2026-08-05
- RPC：Helius Mainnet（`api-key` 已在报告中脱敏）
- Solana Core：4.1.0
- 工具：`scripts/load-test/rpc-load-test.mjs`
- 原始数据：`docs/reports/rpc-load-test-concurrency1.json` /
  `docs/reports/rpc-load-test-concurrency10.json`

## 结论

当前 Helius 套餐的可用吞吐大约在 **15-20 RPS** 左右；并发 10 时约
**40% 请求被 HTTP 429 `Too Many Requests` 限流**，p99 延迟 2.26s。
串行（并发 1）下成功率 98.3%，p50 约 430ms。

上线前建议：

1. 升级 RPC 套餐或配置多个 RPC Key 做轮询/故障转移，目标至少
   **50 RPS 且 p95 < 500ms**。
2. 后端对 `getLatestBlockhash` / `getBalance` 等请求做 100-200ms 短缓存，
   减少无效 RPC 调用。
3. 部署时设置 `WEBHOOK_RETRY_DELAY_MS` 等重试参数，避免限流窗口内重试叠加。
4. 用正式 RPC 重新跑：

```bash
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=xxx" \
  CONCURRENCY=10 TOTAL_REQUESTS=200 \
  node scripts/load-test/rpc-load-test.mjs
```

## 数据摘要

| 场景 | 成功率 | 吞吐 RPS | p50 | p90 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| 并发 1（60 请求） | 98.3% | 1.33 | 430ms | 1034ms | 1164ms | 10.5s |
| 并发 10（200 请求） | 40.5% | 15.84 | 291ms | 1013ms | 1322ms | 2.26s |

失败原因主要为 HTTP 429 `Too Many Requests`；串行场景的一次 p99 长尾
来自首次 TLS 建连。

## 附注

- Helius 对 `getVersion` 不接受小数 `id`（返回 `-32700 Parse error`），
  压测脚本已改用递增整数 `id`。
