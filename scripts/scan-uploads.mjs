#!/usr/bin/env node
// 存量文件批量杀毒扫描：对目录下所有文件通过 clamd INSTREAM（TCP）扫描。
// 运行：node scripts/scan-uploads.mjs [目录]
// 环境变量：CLAMAV_HOST（默认 localhost）、CLAMAV_PORT（默认 3310）
// 退出码：0 = 全部 clean；1 = 存在 FOUND（病毒）/ ERROR / 超时
import { createConnection } from "node:net";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.CLAMAV_HOST ?? "localhost";
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const ROOT = resolve(
  process.argv[2] ??
    join(fileURLToPath(new URL(".", import.meta.url)), "../packages/backend/uploads"),
);

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collect(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

function scanOne(filePath) {
  return new Promise((done) => {
    const socket = createConnection({ host: HOST, port: PORT });
    let response = "";
    let settled = false;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      done({ status, path: filePath, detail });
    };
    const timer = setTimeout(() => finish("timeout", "clamd no response"), 20_000);
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0"));
      const data = readFileSync(filePath);
      for (let offset = 0; offset < data.length; offset += 65_536) {
        const slice = data.subarray(offset, offset + 65_536);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(slice.length, 0); // clamd INSTREAM 网络字节序（大端）
        socket.write(Buffer.concat([header, slice]));
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", () => finish("error", "connection error"));
    socket.on("close", () => {
      if (/FOUND/.test(response)) finish("found", response.trim());
      else if (/size limit/i.test(response)) finish("sizelimit", response.trim());
      else if (/OK/.test(response)) finish("clean");
      else finish("error", response.trim() || "unexpected response");
    });
  });
}

const files = collect(ROOT);
console.log(`scanning ${files.length} file(s) in ${ROOT} via clamd ${HOST}:${PORT}`);
const results = { clean: 0, found: 0, sizelimit: 0, error: 0, timeout: 0 };
const issues = [];
for (const file of files) {
  const r = await scanOne(file);
  results[r.status] = (results[r.status] ?? 0) + 1;
  if (r.status !== "clean") issues.push({ ...r, size: statSync(file).size });
}
console.log(JSON.stringify({ total: files.length, ...results }, null, 2));
for (const i of issues) {
  console.log(`[${i.status}] ${i.path} (${i.size} bytes)${i.detail ? ` ${i.detail}` : ""}`);
}
if (results.found > 0 || results.error > 0 || results.timeout > 0) {
  console.log("SCAN FAILED: found infected/error files above");
  process.exit(1);
}
console.log("ALL CLEAN");
