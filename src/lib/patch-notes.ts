import { prismaPrimary } from "@/modules/platform/db/prisma";
import {
  contentToSections,
  parsePatchNoteContent,
  type PatchNoteContentItem,
  type PatchNoteContentSections,
  type PatchNoteSection,
} from "@/lib/patch-notes-content";

export type { PatchNoteContentItem, PatchNoteContentSections, PatchNoteSection };
export { contentToSections, parsePatchNoteContent } from "@/lib/patch-notes-content";

export type PatchNoteDto = {
  id: string;
  version: string;
  title: string;
  /** Normalized display sections (features, bug fixes, others). */
  sections: PatchNoteSection[];
  /** Raw/normalized content object for clients that prefer the JSON shape. */
  content: PatchNoteContentSections;
  releasedAt: string;
  viewed?: boolean;
};

/**
 * Resolve stable id(s) for patch-note read tracking.
 * Primary key is always the portal account id (NextAuth session subject).
 * Also returns mergedSourceUserId when present so older marks under that key still count.
 */
export async function resolvePatchNotesUserKeys(portalAccountId: string): Promise<{
  primaryUserId: string;
  legacyUserIds: string[];
} | null> {
  const id = portalAccountId.trim();
  if (!id) return null;
  const portal = await prismaPrimary.portalAccount.findUnique({
    where: { id },
    select: { id: true, mergedSourceUserId: true },
  });
  if (!portal) return null;
  const legacyUserIds: string[] = [];
  if (portal.mergedSourceUserId != null) {
    const merged = portal.mergedSourceUserId.toString();
    if (merged && merged !== portal.id) legacyUserIds.push(merged);
  }
  return { primaryUserId: portal.id, legacyUserIds };
}

/** @deprecated Prefer resolvePatchNotesUserKeys — kept for older call sites. */
export async function resolvePatchNotesUserId(portalAccountId: string): Promise<string | null> {
  const keys = await resolvePatchNotesUserKeys(portalAccountId);
  return keys?.primaryUserId ?? null;
}

function toDto(row: {
  id: string;
  version: string;
  title: string;
  content: unknown;
  releasedAt: Date;
}): PatchNoteDto {
  const content = parsePatchNoteContent(row.content);
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    content,
    sections: contentToSections(content),
    releasedAt: row.releasedAt.toISOString(),
  };
}

/** All patch notes, newest release first. */
export async function listPatchNotes(): Promise<PatchNoteDto[]> {
  const rows = await prismaPrimary.patchNote.findMany({
    orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDto);
}

export async function getLatestPatchNote(): Promise<PatchNoteDto | null> {
  const row = await prismaPrimary.patchNote.findFirst({
    orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
  });
  return row ? toDto(row) : null;
}

export async function hasUserViewedPatch(userId: string, patchNoteId: string): Promise<boolean> {
  const view = await prismaPrimary.userPatchNoteView.findUnique({
    where: {
      userId_patchNoteId: { userId, patchNoteId },
    },
    select: { id: true },
  });
  return Boolean(view);
}

export async function getViewedPatchNoteIds(userId: string, patchNoteIds: string[]): Promise<Set<string>> {
  if (patchNoteIds.length === 0) return new Set();
  const views = await prismaPrimary.userPatchNoteView.findMany({
    where: { userId, patchNoteId: { in: patchNoteIds } },
    select: { patchNoteId: true },
  });
  return new Set(views.map((v) => v.patchNoteId));
}

/** Union of viewed patch ids across primary + legacy user keys. */
export async function getViewedPatchNoteIdsForKeys(
  userIds: string[],
  patchNoteIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0 || patchNoteIds.length === 0) return new Set();
  const views = await prismaPrimary.userPatchNoteView.findMany({
    where: { userId: { in: userIds }, patchNoteId: { in: patchNoteIds } },
    select: { patchNoteId: true },
  });
  return new Set(views.map((v) => v.patchNoteId));
}

export async function markPatchNoteViewed(userId: string, patchNoteId: string): Promise<void> {
  await prismaPrimary.userPatchNoteView.upsert({
    where: {
      userId_patchNoteId: { userId, patchNoteId },
    },
    create: { userId, patchNoteId },
    update: { viewedAt: new Date() },
  });
}

/** Mark one note read for primary + any legacy keys. */
export async function markPatchNoteViewedForKeys(
  userIds: string[],
  patchNoteId: string,
): Promise<void> {
  const now = new Date();
  const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  await prismaPrimary.$transaction(
    unique.map((userId) =>
      prismaPrimary.userPatchNoteView.upsert({
        where: { userId_patchNoteId: { userId, patchNoteId } },
        create: { userId, patchNoteId, viewedAt: now },
        update: { viewedAt: now },
      }),
    ),
  );
}

/** Mark every existing patch note as read for this user. */
export async function markAllPatchNotesViewed(userId: string): Promise<number> {
  return markAllPatchNotesViewedForKeys([userId]);
}

/** Mark every existing patch note as read for primary + legacy keys. */
export async function markAllPatchNotesViewedForKeys(userIds: string[]): Promise<number> {
  const patches = await prismaPrimary.patchNote.findMany({ select: { id: true } });
  if (patches.length === 0) return 0;
  const uniqueUsers = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueUsers.length === 0) return 0;
  const now = new Date();
  await prismaPrimary.$transaction(
    uniqueUsers.flatMap((userId) =>
      patches.map((p) =>
        prismaPrimary.userPatchNoteView.upsert({
          where: { userId_patchNoteId: { userId, patchNoteId: p.id } },
          create: { userId, patchNoteId: p.id, viewedAt: now },
          update: { viewedAt: now },
        }),
      ),
    ),
  );
  return patches.length;
}
