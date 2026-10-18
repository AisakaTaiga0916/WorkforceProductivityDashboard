import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import {
  markAllPatchNotesViewedForKeys,
  markPatchNoteViewedForKeys,
  resolvePatchNotesUserKeys,
} from "@/lib/patch-notes";

/**
 * Mark patch notes as read for the signed-in portal user.
 * Body: `{ markAll: true }` or `{ patchNoteId?: string }` (defaults to latest).
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { patchNoteId?: string; markAll?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const keys = await resolvePatchNotesUserKeys(session.user.id);
  if (!keys) {
    return NextResponse.json({ error: "Could not resolve user for patch notes." }, { status: 400 });
  }
  const userIds = [keys.primaryUserId, ...keys.legacyUserIds];

  if (body.markAll === true) {
    const count = await markAllPatchNotesViewedForKeys(userIds);
    const latest = await prismaPrimary.patchNote.findFirst({
      orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, version: true },
    });
    return NextResponse.json({
      ok: true,
      markAll: true,
      count,
      latestId: latest?.id ?? null,
      latestVersion: latest?.version ?? null,
    });
  }

  let patchNoteId = typeof body.patchNoteId === "string" ? body.patchNoteId.trim() : "";
  if (!patchNoteId) {
    const latest = await prismaPrimary.patchNote.findFirst({
      orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest) {
      return NextResponse.json({ error: "No patch notes found." }, { status: 404 });
    }
    patchNoteId = latest.id;
  } else {
    const exists = await prismaPrimary.patchNote.findUnique({
      where: { id: patchNoteId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Patch note not found." }, { status: 404 });
    }
  }

  await markPatchNoteViewedForKeys(userIds, patchNoteId);
  return NextResponse.json({ ok: true, patchNoteId });
}
