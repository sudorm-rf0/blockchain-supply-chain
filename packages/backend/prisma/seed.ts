import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

type SeedRole = "ADMIN" | "SUPER_ADMIN";

/** 引导账号（管理员 / 超级管理员）统一处理：本地演示与 CI e2e 直接登录（emailOtpEnabled=false）。 */
async function seedAccount(
  prisma: PrismaClient,
  opts: {
    email: string;
    password: string;
    name: string;
    role: SeedRole;
    isProduction: boolean;
  },
): Promise<void> {
  const { email, password, name, role, isProduction } = opts;
  const DEFAULT_PASSWORDS = ["Admin123!", "SuperAdmin123!", "admin123", "password", "12345678"];
  if (
    isProduction &&
    (!password ||
      password.length < 12 ||
      DEFAULT_PASSWORDS.includes(password) ||
      /^[A-Za-z0-9]{12,}$/.test(password))
  ) {
    console.error(
      `Refusing to seed ${role} with a weak/default password in production. Set a strong secret (min 12 chars, mix of letters/digits/symbols).`,
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== role) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role, mustChangePassword: true },
      });
      console.log(`Promoted existing user ${email} to ${role}`);
    } else if (!existing.lastPasswordChangeAt) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          mustChangePassword: true,
          emailOtpEnabled: false,
        },
      });
      console.log(`${role} user ${email} must change the initial password.`);
    } else {
      console.log(`${role} user ${email} already exists, skipping.`);
    }
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  await prisma.user.create({
    data: {
      email,
      name,
      wallet: email,
      role,
      mustChangePassword: true,
      passwordHash: `${salt}:${passwordHash}`,
      // 引导账号跳过邮箱验证，直接可用
      emailVerified: true,
      emailVerifiedAt: new Date(),
      // 引导账号例外：本地演示/CI e2e 需直接登录；
      // 真实注册账号强制开启邮箱验证码登录（默认 true）
      emailOtpEnabled: false,
    },
  });
  console.log(`Created ${role} user: ${email}`);
}

async function seed() {
  const prisma = new PrismaClient();
  const isProduction = process.env.NODE_ENV === "production";

  await seedAccount(prisma, {
    email: process.env.ADMIN_EMAIL ?? "admin@supply-chain.io",
    password: process.env.ADMIN_PASSWORD ?? "Admin123!",
    name: process.env.ADMIN_NAME ?? "Admin",
    role: "ADMIN",
    isProduction,
  });

  // 超级管理员（最高权限，可管理账号）
  await seedAccount(prisma, {
    email: process.env.SUPER_ADMIN_EMAIL ?? "root@supply-chain.io",
    password: process.env.SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!",
    name: process.env.SUPER_ADMIN_NAME ?? "Super Admin",
    role: "SUPER_ADMIN",
    isProduction,
  });

  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
