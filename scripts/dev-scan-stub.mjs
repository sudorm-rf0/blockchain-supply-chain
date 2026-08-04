// 本地开发用病毒扫描 stub：HTTP JSON `{clean:true}`，仅用于无 ClamAV 的开发环境。
// 用法：PORT=3311 node scripts/dev-scan-stub.mjs
// 生产必须配置真实 CLAMAV_HOST 或 SCAN_URL。
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3311);

createServer((req, res) => {
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
  });
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ clean: true, bytes: size }));
  });
}).listen(port, () => {
  console.log(`dev scan stub listening on ${port}`);
});
