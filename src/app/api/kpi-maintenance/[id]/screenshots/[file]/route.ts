import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { isItProjectEnvelope, itProjectAllItems, parseItProjectSubKpis } from "@/lib/it-project-subkpis";
import {
  collectAllSubKpiItems,
  getArchivedTaskScreenshots,
  getPillarScreenshots,
  hasSubKpiAssignedTo,
  normalizeSubKpis,
} from "@/lib/kpi-subkpis";
import { prisma } from "@/lib/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { taskScreenshotsUploadDir } from "@/lib/task-screenshots";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const { session, unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
  ]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id, file: fileParam } = await ctx.params;

  let storedFileName: string;
  try {
    storedFileName = path.basename(decodeURIComponent(fileParam));
  } catch {
    return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  }
  if (!storedFileName || storedFileName.includes("..")) {
    return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  }

  const row = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true, subKpis: true },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const canAccess =
    perms.canAssignWork ||
    row.assignedAgentId === perms.operator?.id ||
    hasSubKpiAssignedTo(row.subKpis, perms.operator?.id);
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items = isItProjectEnvelope(row.subKpis)
    ? itProjectAllItems(parseItProjectSubKpis(row.subKpis))
    : collectAllSubKpiItems(normalizeSubKpis(row.subKpis));
  const meta = items
    .flatMap((it) => [
      ...(it.beforeScreenshot ?? []),
      ...(it.afterScreenshot ?? []),
      ...(it.uploadScreenshot ?? []),
    ])
    .concat(getPillarScreenshots(row.subKpis, "before"), getPillarScreenshots(row.subKpis, "after"))
    .concat(getPillarScreenshots(row.subKpis, "general"))
    .concat(
      getArchivedTaskScreenshots(row.subKpis).flatMap((archive) => [
        ...(archive.pillarBeforeScreenshot ?? []),
        ...(archive.pillarAfterScreenshot ?? []),
        ...(archive.pillarScreenshot ?? []),
        ...archive.subTasks.flatMap((it) => [
          ...(it.beforeScreenshot ?? []),
          ...(it.afterScreenshot ?? []),
          ...(it.uploadScreenshot ?? []),
        ]),
      ]),
    )
    .find((m) => m?.storedFileName === storedFileName);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buf = await readFile(path.join(taskScreenshotsUploadDir(id), storedFileName));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": meta.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing." }, { status: 404 });
  }
}
