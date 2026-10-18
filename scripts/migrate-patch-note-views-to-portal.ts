/**
 * Copy legacy patch-note views (stored under mergedSourceUserId)
 * onto the portal account id so Mark All as Read sticks after the key change.
 */
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null } },
    select: { id: true, mergedSourceUserId: true, email: true },
  });

  let copied = 0;
  for (const portal of portals) {
    if (portal.mergedSourceUserId == null) continue;
    const legacyId = portal.mergedSourceUserId.toString();
    if (!legacyId || legacyId === portal.id) continue;

    const legacyViews = await prismaPrimary.userPatchNoteView.findMany({
      where: { userId: legacyId },
      select: { patchNoteId: true, viewedAt: true },
    });
    if (legacyViews.length === 0) continue;

    for (const view of legacyViews) {
      await prismaPrimary.userPatchNoteView.upsert({
        where: {
          userId_patchNoteId: { userId: portal.id, patchNoteId: view.patchNoteId },
        },
        create: {
          userId: portal.id,
          patchNoteId: view.patchNoteId,
          viewedAt: view.viewedAt,
        },
        update: {},
      });
      copied += 1;
    }
    console.log(`Migrated ${legacyViews.length} view(s) for ${portal.email} (${legacyId} -> ${portal.id})`);
  }
  console.log(`Done. Upserted ${copied} portal-keyed view row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
