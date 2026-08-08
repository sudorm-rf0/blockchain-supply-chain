// S3 兼容对象存储连通性测试（Cloudflare R2 / MinIO / AWS S3 通用）
// 用于评估 R2 是否可作为文件单证存储。
// 用法（cwd = packages/backend）：
//   S3_ENDPOINT=<endpoint> S3_BUCKET=<bucket> S3_FORCE_PATH_STYLE=true \
//   AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret> \
//   node scripts/test-s3-storage.mjs
// 示例（MinIO）：
//   S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=docs S3_REGION=us-east-1 S3_FORCE_PATH_STYLE=true \
//   AWS_ACCESS_KEY_ID=supplychain AWS_SECRET_ACCESS_KEY=supplychain123 node scripts/test-s3-storage.mjs
// 示例（Cloudflare R2）：
//   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com S3_BUCKET=<BUCKET> S3_FORCE_PATH_STYLE=true \
//   AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID> AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY> node scripts/test-s3-storage.mjs
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET ?? "supply-chain-files";
const region = process.env.S3_REGION ?? "us-east-1";
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";
const ak = process.env.AWS_ACCESS_KEY_ID;
const sk = process.env.AWS_SECRET_ACCESS_KEY;

if (!endpoint || !ak || !sk) {
  console.error("❌ 缺少连接配置：需设置 S3_ENDPOINT / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
  console.error("   示例见脚本头部注释");
  process.exit(2);
}

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle,
  credentials: { accessKeyId: ak, secretAccessKey: sk },
  requestHandler: { requestTimeout: 30_000 },
});

const key = `docs/test-single-certificate-${Date.now()}.json`;
const content = JSON.stringify({
  docType: "仓单/物流单证",
  tradeId: 1,
  amountUsdc: 100_000,
  checksum: "sha256-test",
  createdAt: new Date().toISOString(),
}, null, 2);

const results = {};
try {
  // 1) 连通性 + 建桶（若不存在）
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    results.bucket = "created";
  } catch (e) {
    if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(String(e?.name ?? ""))) {
      results.bucket = "already-exists";
    } else {
      results.bucket = `skip (${e?.name ?? "n/a"})`;
    }
  }
  console.log(`[1/5] bucket(${bucket}) 就绪: ${results.bucket}`);

  // 2) 上传（模拟文件单证）
  const put = await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: content, ContentType: "application/json",
  }));
  results.upload = true;
  console.log(`[2/5] 上传成功: s3://${bucket}/${key} (${Buffer.byteLength(content)} bytes)`);

  // 3) 下载并校验内容
  const get = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await get.Body.transformToString();
  results.roundtrip = body === content;
  console.log(`[3/5] 下载校验: ${results.roundtrip ? "内容一致 ✅" : "内容不一致 ❌"}`);

  // 4) 存在性检查（HeadObject）
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  results.exists = true;
  console.log("[4/5] HeadObject 存在: ✅");

  // 5) 删除并确认
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  let gone = false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    gone = true;
  }
  results.delete = gone;
  console.log(`[5/5] 删除: ${gone ? "✅" : "❌"}`);

  const ok = results.roundtrip === true && results.exists === true && results.delete === true;
  console.log("==============================================");
  console.log(ok ? "✅ S3 兼容存储测试通过：可作为文件单证存储" : "❌ 测试未全部通过");
  console.log("结果:", JSON.stringify(results));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("❌ 测试异常:", e?.name, e?.message);
  process.exit(1);
}
