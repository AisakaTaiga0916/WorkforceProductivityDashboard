/**
 * Reset one portal account password by username or email.
 *
 * Usage:
 *   npx tsx scripts/reset-portal-password.ts ag88
 *   RESET_PORTAL_PASSWORD="CustomPass123" npx tsx scripts/reset-portal-password.ts ag88
 */
import bcrypt from "bcryptjs";
import { DEFAULT_PASSWORD_RESET } from "../src/lib/default-reset-password";
import { prisma } from "../src/modules/platform/db/prisma";

const loginId = (process.argv[2] ?? "").trim();
if (!loginId) {
  console.error("Usage: npx tsx scripts/reset-portal-password.ts <username-or-email>");
  process.exit(1);
}

const newPassword = process.env.RESET_PORTAL_PASSWORD?.trim() || DEFAULT_PASSWORD_RESET;

async function main() {
  const portal = await prisma.portalAccount.findFirst({
    where: {
      OR: [
        { username: { equals: loginId, mode: "insensitive" } },
        { email: { equals: loginId, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, email: true, name: true, role: true },
  });

  if (!portal) {
    console.error(`No portal account found for "${loginId}".`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.portalAccount.update({
    where: { id: portal.id },
    data: { passwordHash },
  });

  console.log("Password reset OK.");
  console.log(`  Username: ${portal.username ?? "(none)"}`);
  console.log(`  Email:    ${portal.email}`);
  console.log(`  Name:     ${portal.name}`);
  console.log(`  Role:     ${portal.role}`);
  console.log(`  New password: ${newPassword}`);
  console.log("Sign in at /signin with username (or email) and this password.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
