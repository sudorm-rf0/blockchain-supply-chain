import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";
const TRADE = process.env.TRADE_URL ?? "http://localhost:3004";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function seedAdmin(): Promise<{ email: string; password: string }> {
  const email = `e2e-admin-${Date.now()}@example.com`;
  const password = "E2eAdmin!";
  const res = await fetch(`${BACKEND}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "E2E Admin", password }),
  });
  if (!res.ok) throw new Error(`seed admin failed: ${res.status}`);
  return { email, password };
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
  await uploadPng(page, "invoice-v2.png", Buffer.concat([TINY_PNG, Buffer.from([1])]), "ui-invoice");

  await page.goto(`${BASE}/user/files`);
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  await expect(page.getByText("（已更新）")).toBeVisible();
});

test("admin is forced to change the password and can open order detail", async ({
  page,
  request,
}) => {
  const { email, password } = await seedAdmin();

  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/change-password", { timeout: 10_000 });
  await page.fill("#currentPassword", password);
  const newPassword = "E2eAdmin2!";
  await page.fill("#newPassword", newPassword);
  await page.fill("#confirmPassword", newPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/files", { timeout: 15_000 });

  const loginRes = await request.post(`${BACKEND}/api/auth/login`, {
    data: { email, password: newPassword },
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
