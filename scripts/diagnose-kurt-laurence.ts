#!/usr/bin/env npx tsx
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  for (const name of ["Kurt", "Laurence", "Miñoza", "Minoza", "Magsadia", "Mark Anthony", "Reginald"]) {
    const portals = await prismaPrimary.portalAccount.findMany({
      where: { name: { contains: name, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        accountStatus: true,
        mergedSourceUserId: true,
      },
    });
    const agents = await prismaPrimary.agent.findMany({
      where: { name: { contains: name, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    });
    console.log(name, {
      portals: portals.map((p) => ({
        ...p,
        mergedSourceUserId: p.mergedSourceUserId?.toString() ?? null,
      })),
      agents,
    });
  }

  const merged = await prismaSecondary.$queryRawUnsafe(`
    SELECT source_user_id, name, email, username FROM merged_users
    WHERE is_active = 1 AND (
      LOWER(name) LIKE '%kurt%' OR LOWER(name) LIKE '%laurence%' OR LOWER(name) LIKE '%magsadia%'
      OR LOWER(name) LIKE '%minoza%' OR LOWER(name) LIKE '%miñoza%'
    )
  `);
  console.log("merged matches", merged);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaSecondary.$disconnect();
  });
