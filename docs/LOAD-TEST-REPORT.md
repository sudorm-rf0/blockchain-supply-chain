# 压力测试报告

日期：2026-08-02
环境：macOS（Apple Silicon，10 核 / 16GB），Node 24，服务本地运行，
Postgres/Redis/Solana localnet 使用 Docker。
工具：autocannon、自研并发上传脚本 `scripts/load-test/`。

## 结果汇总

| 场景 | 并发 | 时长 | 请求量 | 吞吐 | 平均延迟 | P99 | 错误 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/health`（主后端） | 50 | 10s | 46.2 万 | 42k req/s | 0.9ms | 2ms | 0（超限流后 429 属预期） |
| `/api/indexer/status` | 50 | 10s | 7.1 万 | 7.1k req/s | 7.2ms | 18ms | 0 |
| `/api/pool/overview`（Redis 缓存） | 50 | 10s | 41.1 万 | 41k req/s | 0.6ms | 3ms | 0 |
| `/api/files`（JWT + DB） | 50 | 10s | 4.9 万 | 4.5k req/s | 10.6ms | 22ms | 0 |
| `/api/trades`（JWT + DB） | 50 | 10s | 6.3 万 | 6.3k req/s | 7.4ms | 17ms | 0 |
| `/api/auth/login`（scrypt） | 10 | 8s | 1439 | 180 req/s | 55ms | 81ms | 0 |
| 文件上传（小 PNG） | 10 | 30 个 | 30 | 532 文件/s | 18ms | 42ms | 0 |
| `/api/trades` POST（RPC 预构建） | 10 | 6s | 4345 | 724 req/s | 13.3ms | 27ms | 0 |

## 发现与修复

1. 生产构建启动路径错误：`nest build` 输出 `dist/src/main.js`，但
   `package.json start` 与 Dockerfile CMD 指向 `dist/main.js`，镜像会启动失败。
   已修复为 `dist/src/main.js`。
2. 限流上限原先硬编码 120 次/分钟，压测会快速触发 429。现支持
   `THROTTLE_LIMIT` 环境变量，默认仍为 120；压测时设置 100000 验证容量。
3. 高并发（4 万+ req/s）后 Prisma 引擎出现瞬时 100% CPU 尖峰，事件循环与
   健康检查保持正常，数秒后回落。生产建议：限制 Prisma 连接池、设置
   `UV_THREADPOOL_SIZE`、接入 CPU/连接数监控与告警。
4. `scrypt` 单次约 30ms，登录在 10 并发下约 180 req/s、P99 81ms，可接受；
   生产可考虑 Argon2id 或独立身份服务，并保留严格登录限流。
5. 小文件上传走本地磁盘流式 + SHA-256，并发表现良好；生产换 S3/OSS 后
   吞吐取决于对象存储分片与带宽，建议单独做对象存储压测。
6. 高并发读压测后 Postgres 出现 `too many clients`，连接池无上限导致
   连接被耗尽。已在所有 Prisma `DATABASE_URL` 配置 `connection_limit=5`，
   复测 5 万+ 请求后连接数稳定在 28，不再上涨。

## 结论

本地环境容量足够支撑 demo 与中小规模使用：读接口可达数千到数万 req/s，
写路径（登录、上传、交易预构建）在 10 并发下均无错误且延迟稳定。真实上线
前仍需在生产集群复测，并关注 RPC 配额、数据库连接池与对象存储上限。

## 复跑

```bash
LOGIN_EMAIL=admin@supply-chain.io LOGIN_PASSWORD=Admin123! \
DURATION=10 CONCURRENCY=50 bash scripts/load-test/run-load-test.sh

CONCURRENCY=10 TOTAL=30 node scripts/load-test/upload-test.mjs
```
