import { runHrisPortalSync } from "../src/modules/platform/auth/hris-sync-job";
import { prismaAuth, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const result = await runHrisPortalSync();
  console.log(`[sync-hris-portal-incremental] total=${result.total} synced=${result.synced} failed=${result.failed} duration=${result.durationMs}ms`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaAuth.$disconnect();
    await prismaSecondary.$disconnect();
  });
