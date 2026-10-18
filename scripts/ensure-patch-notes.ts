import { Prisma } from "@prisma/client/primary";
import { prismaPrimary } from "../src/modules/platform/db/prisma";
import { PATCH_NOTE_SEEDS } from "../src/lib/patch-notes-seed";

async function ensureTables() {
  await prismaPrimary.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await prismaPrimary.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PatchNote" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      content JSONB NOT NULL,
      "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prismaPrimary.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserPatchNoteView" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId" TEXT NOT NULL,
      "patchNoteId" TEXT NOT NULL REFERENCES "PatchNote"(id) ON DELETE CASCADE,
      "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("userId", "patchNoteId")
    )
  `);
  await prismaPrimary.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PatchNote_releasedAt_idx" ON "PatchNote"("releasedAt")`,
  );
  await prismaPrimary.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "UserPatchNoteView_userId_idx" ON "UserPatchNoteView"("userId")`,
  );
}

/** Insert missing versions and refresh seed content/title/releasedAt for known versions. */
async function syncSeeds() {
  for (const seed of PATCH_NOTE_SEEDS) {
    const existing = await prismaPrimary.patchNote.findFirst({
      where: { version: seed.version },
      select: { id: true },
    });
    const data = {
      title: seed.title,
      content: seed.content as Prisma.InputJsonValue,
      releasedAt: new Date(seed.releasedAt),
    };
    if (existing) {
      await prismaPrimary.patchNote.update({
        where: { id: existing.id },
        data,
      });
      console.log(`Updated PatchNote ${seed.version}`);
    } else {
      await prismaPrimary.patchNote.create({
        data: {
          version: seed.version,
          ...data,
        },
      });
      console.log(`Seeded PatchNote ${seed.version}`);
    }
  }
}

async function main() {
  await ensureTables();
  console.log("PatchNote tables ensured");
  await syncSeeds();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
