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

async function readDevCode(page: Page): Promise<string> {
  const el = page.getByText(/开发模式验证码：\d{6}/).first();
  await expect(el).toBeVisible({ timeout: 15_000 });
  const text = (await el.textContent()) ?? "";
  const m = text.match(/(\d{6})/);
  if (!m) throw new Error(`devCode not found in: ${text}`);
  return m[1];
}

async function registerUser(page: Page): Promise<string> {
  const email = `ui-${Date.now()}@example.com`;
  await page.goto(`${BASE}/register`);
  await page.fill("#name", "UI User");
  await page.fill("#email", email);
  await page.fill("#password", "secret123");
  await page.fill("#confirmPassword", "secret123");
  await page.click('button[type="submit"]');

  // 注册后强制邮箱验证：读 dev 验证码 toast，填码激活
  await page.waitForURL("**/verify-email?*", { timeout: 15_000 });
  const regCode = await readDevCode(page);
  await page.fill("#code", regCode);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/login", { timeout: 15_000 });

  // 登录（强制邮箱验证码）：注册已触发 60s 发送冷却，等按钮恢复后手动发码
  await page.fill("#email", email);
  await page.fill("#password", "secret123");
  await page.click('button[type="submit"]');
  await expect(page.locator("#email-otp")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        /发送验证码|s 后可重发/.test(b.textContent ?? ""),
      );
      return Boolean(btn && /发送验证码/.test(btn.textContent ?? ""));
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: "发送验证码" }).click();
  const loginCode = await readDevCode(page);
  await page.fill("#email-otp", loginCode);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/user/upload", { timeout: 15_000 });
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

// ---- 补充用例辅助函数（2026-08-18）----

async function adminLogin(page: Page): Promise<void> {
  // 管理员 UI 登录：与现有 admin 用例一致，不要求邮箱验证码；首次强制改密时自动改密。
  const { email } = await seedAdmin();
  const candidates = ["Admin123!", "E2eAdmin2!"];
  for (const password of candidates) {
    await page.goto(`${BASE}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL(/\/change-password|\/admin\/files/, { timeout: 10_000 });
    } catch {
      continue;
    }
    if (page.url().includes("change-password")) {
      await page.fill("#currentPassword", password);
      await page.fill("#newPassword", "E2eAdmin2!");
      await page.fill("#confirmPassword", "E2eAdmin2!");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/admin/files", { timeout: 15_000 });
    }
    return;
  }
  throw new Error("admin UI login failed");
}

function adminFileRow(page: Page, uploaderEmail: string) {
  return page.getByRole("row").filter({ hasText: uploaderEmail }).first();
}



test("admin review loop: reject v1, user resubmits v2, approve, status syncs", async ({
  browser,
}) => {
  // 使用两个独立浏览器上下文，避免管理员/用户会话互相干扰
  const userCtx = await browser.newContext();
  const adminCtx = await browser.newContext();
  const user = await userCtx.newPage();
  const admin = await adminCtx.newPage();
  try {
    const email = await registerUser(user);
    const docId = `review-${Date.now()}`;

    // 用户上传 v1
    await uploadPng(user, "invoice-v1.png", TINY_PNG, docId);

    // 管理员登录 → 待审核列表 → 驳回 v1
    await adminLogin(admin);
    await admin.goto(`${BASE}/admin/files?status=PENDING`);
    await adminFileRow(admin, email).getByRole("button", { name: "驳回" }).click();
    await admin.getByRole("dialog").locator("textarea").fill("e2e: 请补充抬头信息");
    await admin.getByRole("button", { name: "确认驳回" }).click();
    await expect(admin.getByText("已驳回")).toBeVisible({ timeout: 15_000 });

    // 用户端（仍在登录态）看到 v1 已驳回
    await user.goto(`${BASE}/user/files`);
    await expect(user.getByText("已驳回").first()).toBeVisible({ timeout: 15_000 });

    // 用户用同一单据编号重传 v2（自动生成新版本）
    await uploadPng(user, "invoice-v2.png", TINY_PNG_V2, docId);
    await user.goto(`${BASE}/user/files`);
    await expect(user.getByText("v2", { exact: true })).toBeVisible({ timeout: 15_000 });

    // 管理员通过 v2（v1 已驳回，PENDING 列表只含 v2）
    await admin.goto(`${BASE}/admin/files?status=PENDING`);
    await adminFileRow(admin, email).getByRole("button", { name: "通过" }).click();
    await admin.getByRole("button", { name: "确认通过" }).click();
    await expect(admin.getByText("审核通过")).toBeVisible({ timeout: 15_000 });

    // 用户端最终看到已通过
    await user.goto(`${BASE}/user/files`);
    await expect(user.getByText("已通过").first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await userCtx.close();
    await adminCtx.close();
  }
});

test("public verification by document id and on-chain trace timeline", async ({
  page,
}) => {
  const docId = `verify-${Date.now()}`;
  await registerUser(page);
  await uploadPng(page, "verify.png", TINY_PNG, docId);

  // 溯源：我的文件 → 链上溯源（公开只读页）
  await page.goto(`${BASE}/user/files`);
  await page.getByRole("link", { name: "链上溯源" }).first().click();
  await page.waitForURL("**/trace/**", { timeout: 15_000 });
  await expect(page.getByText(/溯源/).first()).toBeVisible({ timeout: 15_000 });

  // 公开核验：/verify 按单据编号查询
  await page.goto(`${BASE}/verify`);
  await page.getByPlaceholder("文件哈希 / 文件 ID / 交易签名").fill(docId);
  await page.getByRole("button", { name: "核验" }).click();
  await expect(page.getByText("核验通过")).toBeVisible({ timeout: 15_000 });
});

