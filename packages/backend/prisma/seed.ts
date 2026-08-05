import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

async function seed() {
  const prisma = new PrismaClient();

  const email = process.env.ADMIN_EMAIL ?? "admin@supply-chain.io";
  const password = process.env.ADMIN_PASSWORD ?? "Admin123!";
  const name = process.env.ADMIN_NAME ?? "Admin";

  if (
    process.env.NODE_ENV === "production" &&
    (!password || password === "Admin123!")
  ) {
    console.error(
      "Refusing to seed the default admin password in production. Set ADMIN_PASSWORD to a strong secret.",
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", mustChangePassword: true },
      });
      console.log(`Promoted existing user ${email} to ADMIN`);
    } else if (!existing.lastPasswordChangeAt) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { mustChangePassword: true },
      });
      console.log(`Admin user ${email} must change the initial password.`);
    } else {
      console.log(`Admin user ${email} already exists, skipping.`);
    }
  } else {
    const salt = randomBytes(16).toString("hex");
    const passwordHash = scryptSync(password, salt, 64).toString("hex");
    await prisma.user.create({
      data: {
        email,
        name,
        wallet: email,
        role: "ADMIN",
        mustChangePassword: true,
        passwordHash: `${salt}:${passwordHash}`,
      },
    });
    console.log(`Created admin user: ${email}`);
  }

  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
