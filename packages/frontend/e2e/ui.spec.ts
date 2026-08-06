import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";
const TRADE = process.env.TRADE_URL ?? "http://localhost:3004";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const TINY_PNG_V2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// 注：CI 自托管 runner 使用独立 JWT_SECRET，注册接口不会传 confirmPassword。

async function seedAdmin(): Promise<{ email: string; password: string }> {
  // CI 使用 seed 重建的种子管理员；本地重复运行时密码可能已被改密流程更新。
  const candidates = ["Admin123!", "E2eAdmin2!"];
  for (const password of candidates) {
    const res = await fetch(`${BACKEND}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@supply-chain.io", password }),
    });
    if (res.ok) return { email: "admin@supply-chain.io", password };
  }
  throw new Error("seed admin login failed");
}

async function registerUser(page: Page): Promise<string> {
  const email = `ui-${Date.now()}@example.com`;
  await page.goto(`${BASE}/register`);
  await page.fill("#name", "UI User");
  await page.fill("#email", email);
  await page.fill("#password", "secret123");
  await page.fill("#confirmPassword", "secret123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/user/upload");
  return email;
}

async function uploadPng(
  page: Page,
  name: string,
  buffer: Buffer,
  documentId: string,
) {
  await page.goto(`${BASE}/user/upload`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "image/png", buffer });
  await page.fill("#documentId", documentId);
  await page.getByRole("button", { name: "上传文件" }).click();
  await expect(page.getByText("上传成功")).toBeVisible({ timeout: 20_000 });
}

test("user can upload versioned documents and sees the camera entry", async ({
  page,
}) => {
  await registerUser(page);
  await expect(page.getByText("拍照上传", { exact: true })).toBeVisible();

  await uploadPng(page, "invoice-v1.png", TINY_PNG, "ui-invoice");
  await uploadPng(page, "invoice-v2.png", TINY_PNG_V2, "ui-invoice");

  await page.goto(`${BASE}/user/files`);
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  await expect(page.getByText("（已更新）")).toBeVisible();
});

test("admin is forced to change the password and can open order detail", async ({
  page,
  request,
}) => {
  const { email, password: seedPassword } = await seedAdmin();
  let password = seedPassword;
  let newPassword = seedPassword;

  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/change-password|\/admin\/files/, { timeout: 10_000 });
  if (page.url().includes("change-password")) {
    await page.fill("#currentPassword", password);
    newPassword = "E2eAdmin2!";
    await page.fill("#newPassword", newPassword);
    await page.fill("#confirmPassword", newPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin/files", { timeout: 15_000 });
    password = newPassword;
  }

  const loginRes = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBe(true);
  const login = (await loginRes.json()) as { accessToken: string };
  const tradesRes = await request.get(`${TRADE}/api/trades/admin`, {
    headers: { authorization: `Bearer ${login.accessToken}` },
  });
  expect(tradesRes.ok()).toBe(true);
  const trades = (await tradesRes.json()) as Array<{ tradeId: string }>;
  expect(trades.length).toBeGreaterThan(0);

  await page.goto(`${BASE}/orders/${trades[0].tradeId}`);
  await expect(page.getByText("订单详情")).toBeVisible();
  await expect(page.getByText(/关联单据（\d+）/)).toBeVisible();
});

// ---- TOTP 两步验证端到端（与后端 node:crypto 原生 TOTP 算法一致）----
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCodeAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (bin % 1_000_000).toString().padStart(6, "0");
}

function currentTotp(secret: string): string {
  return totpCodeAt(secret, Math.floor(Date.now() / 1000 / 30));
}

test("admin can enable TOTP and must enter a code on next login", async ({
  page,
  request,
}) => {
  const { email, password } = await seedAdmin();

  // 1) API 登录 -> 生成密钥 -> 用验证码开启 TOTP
  const loginRes = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const setupRes = await request.post(`${BACKEND}/api/auth/totp/setup`);
  expect(setupRes.ok()).toBeTruthy();
  const { secret } = (await setupRes.json()) as { secret: string };
  const enableRes = await request.post(`${BACKEND}/api/auth/totp/enable`, {
    data: { code: currentTotp(secret) },
  });
  expect(enableRes.ok()).toBeTruthy();
  await request.post(`${BACKEND}/api/auth/logout`);

  try {
    // 2) UI 登录：先输账号密码，出现两步验证码输入，填码后登录成功
    await page.goto(`${BASE}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await expect(page.locator("#totp")).toBeVisible({ timeout: 15_000 });
    await page.fill("#totp", currentTotp(secret));
    await page.click('button[type="submit"]');
    // 登录成功：离开 /login（管理员可能被引导到改密页或管理页）
    await page.waitForURL(/\/(admin|change-password)/, { timeout: 15_000 });
  } finally {
    // 3) 清理：重新登录（现在需要验证码）并关闭 TOTP，避免影响其它用例
    const reLogin = await request.post(`${BACKEND}/api/auth/login`, {
      data: { email, password, totpCode: currentTotp(secret) },
    });
    if (reLogin.ok()) {
      await request.post(`${BACKEND}/api/auth/totp/disable`, {
        data: { code: currentTotp(secret) },
      });
    }
  }
});
