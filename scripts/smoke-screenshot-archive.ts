/**
 * Smoke test: recurring KPI rollover archives screenshots instead of carrying them forward.
 *
 * Usage: npx tsx scripts/smoke-screenshot-archive.ts
 */
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { DateTime } from "luxon";
import {
  getArchivedTaskScreenshots,
  getPillarScreenshots,
  normalizeSubKpis,
  resetAllSubKpiDone,
} from "../src/modules/tasks/kpi-subkpis";
import { computePeriodKey, getDailyPeriodStartDt, normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
import { prisma } from "../src/modules/platform/db/prisma";
import { taskScreenshotsUploadDir } from "../src/modules/tasks/task-screenshots";

const SMOKE_TITLE = "__SMOKE_SCREENSHOT_ARCHIVE__";
const timeZone = normalizeTimeZone(process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");

const screenshot = {
  storedFileName: "smoke-before.png",
  originalName: "smoke-before.png",
  mimeType: "image/png" as const,
  size: 12,
  uploadedAt: new Date().toISOString(),
};

const screenshotAfter = {
  ...screenshot,
  storedFileName: "smoke-after.png",
  originalName: "smoke-after.png",
};

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

function pass(msg: string) {
  console.log("PASS:", msg);
}

async function main() {
  const subKpiId = `smoke-sub-${Date.now()}`;
  const subKpis = {
    segmented: false,
    items: [
      {
        id: subKpiId,
        title: "Smoke daily check",
        done: true,
        screenshotsEnabled: true,
        beforeScreenshot: [screenshot],
        afterScreenshot: [screenshotAfter],
      },
    ],
    pillarScreenshotsEnabled: true,
    pillarBeforeScreenshot: [screenshot],
    pillarAfterScreenshot: [],
  };

  const now = new Date();
  const staleCycleStart = DateTime.fromISO("2020-01-01", { zone: timeZone }).toJSDate();
  const expectedKey = computePeriodKey("DAILY", null, null, now, timeZone);

  const row = await prisma.kpiMaintenance.create({
    data: {
      title: SMOKE_TITLE,
      isRecurring: true,
      frequency: "DAILY",
      subKpis,
      periodCycleStartAt: staleCycleStart,
      periodKey: computePeriodKey("DAILY", null, null, staleCycleStart, timeZone),
      createdBy: "smoke-test",
      createdByRole: "SuperAdmin",
    },
  });

  const uploadDir = taskScreenshotsUploadDir(row.id);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, screenshot.storedFileName), Buffer.from("smoke"));
  await writeFile(path.join(uploadDir, screenshotAfter.storedFileName), Buffer.from("smoke"));

  // Simulate calendar rollover (same path as GET /api/kpi-maintenance after stale cycle detected).
  const resetSubKpis = resetAllSubKpiDone(row.subKpis);
  await prisma.kpiMaintenance.update({
    where: { id: row.id },
    data: {
      subKpis: resetSubKpis,
      periodCycleStartAt: getDailyPeriodStartDt(now, timeZone).toJSDate(),
      periodKey: expectedKey,
      lastFullCompletionAt: null,
      rolledOverIncomplete: true,
    },
  });

  const updated = await prisma.kpiMaintenance.findUnique({
    where: { id: row.id },
    select: { subKpis: true },
  });
  if (!updated) fail("Smoke KPI row missing after update");

  const norm = normalizeSubKpis(updated.subKpis);
  const items = norm.segmented ? norm.segments.flatMap((s) => s.items) : norm.flat;
  const item = items.find((it) => it.id === subKpiId);
  if (!item) fail("Sub-task missing after rollover");
  if (item.done !== false) fail(`Expected done=false, got ${item.done}`);
  if (item.beforeScreenshot?.length) fail("Active before screenshots should be cleared");
  if (item.afterScreenshot?.length) fail("Active after screenshots should be cleared");
  if (getPillarScreenshots(updated.subKpis, "before").length) fail("Active pillar before should be cleared");
  if (getPillarScreenshots(updated.subKpis, "after").length) fail("Active pillar after should stay empty");

  const archives = getArchivedTaskScreenshots(updated.subKpis);
  if (archives.length !== 1) fail(`Expected 1 archive set, got ${archives.length}`);
  const archive = archives[0]!;
  const archivedSub = archive.subTasks.find((it) => it.id === subKpiId);
  if (!archivedSub) fail("Archived sub-task not found");
  if (archivedSub.beforeScreenshot?.[0]?.storedFileName !== screenshot.storedFileName) {
    fail("Archived before screenshot filename mismatch");
  }
  if (archivedSub.afterScreenshot?.[0]?.storedFileName !== screenshotAfter.storedFileName) {
    fail("Archived after screenshot filename mismatch");
  }
  if (archive.pillarBeforeScreenshot?.[0]?.storedFileName !== screenshot.storedFileName) {
    fail("Archived pillar before screenshot filename mismatch");
  }

  const beforePath = path.join(uploadDir, screenshot.storedFileName);
  const afterPath = path.join(uploadDir, screenshotAfter.storedFileName);
  try {
    await import("fs/promises").then((fs) => fs.access(beforePath));
    await import("fs/promises").then((fs) => fs.access(afterPath));
  } catch {
    fail("Screenshot files should remain on disk after archive");
  }

  pass("Rollover archives screenshots and clears active slots");
  pass("Screenshot files remain on disk for archived access");

  await prisma.kpiMaintenance.delete({ where: { id: row.id } });
  await rm(uploadDir, { recursive: true, force: true });
  console.log("\nSmoke test complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
