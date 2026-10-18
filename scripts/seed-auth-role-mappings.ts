/**
 * Seed default HRIS → portal role mappings into Auth DB.
 * Run after db:push:auth
 *
 * Usage: npm run db:seed:auth-role-mappings
 */
import { DEFAULT_HRIS_ROLE_MAPPINGS } from "../src/modules/platform/auth/role-mapping";
import { prismaAuth } from "../src/modules/platform/db/prisma";

async function main() {
  for (const row of DEFAULT_HRIS_ROLE_MAPPINGS) {
    await prismaAuth.roleMapping.upsert({
      where: { hrisRole: row.hrisRole },
      create: {
        hrisRole: row.hrisRole,
        portalRole: row.portalRole,
        headPrivileges: row.headPrivileges,
      },
      update: {
        portalRole: row.portalRole,
        headPrivileges: row.headPrivileges,
      },
    });
  }
  console.log(`[seed-auth-role-mappings] upserted ${DEFAULT_HRIS_ROLE_MAPPINGS.length} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaAuth.$disconnect();
  });
