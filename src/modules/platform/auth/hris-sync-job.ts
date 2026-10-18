import { runHrisAttendanceSync } from "@/modules/platform/auth/hris-attendance-sync";
import { syncHrisPasswordsIntoMerged } from "@/modules/platform/auth/merged-credentials";
import { importMergedUsers, readMergedDump } from "@/modules/platform/auth/merged-user-import";
import { reconcilePortalStaffRolesFromOrgChart } from "@/modules/platform/scope/org-chart-section-scope";
import { runHrisToMergedIncremental } from "@/lib/sync/hris-to-merged-incremental";

export type HrisSyncResult = {
  total: number;
  synced: number;
  failed: number;
  durationMs: number;
  mergeUserChanges?: number;
  mergeAttendanceChanges?: number;
  attendanceUpserted?: number;
  passwordsUpdated?: number;
};

export async function runHrisPortalSync(): Promise<HrisSyncResult> {
  const start = Date.now();

  // Pull new/changed HRIS users into merged first so portal sync sees them.
  let mergeUserChanges = 0;
  let mergeAttendanceChanges = 0;
  try {
    const merge = await runHrisToMergedIncremental({ verbose: false });
    mergeUserChanges = merge.userChanges;
    mergeAttendanceChanges = merge.attendanceChanges;
    console.log(
      `[hris-sync-job] HRIS→merged: users=${merge.userChanges} attendance=${merge.attendanceChanges} (${merge.durationMs}ms)`,
    );
  } catch (e) {
    console.error("[hris-sync-job] HRIS→merged incremental failed", e);
  }

  // Pull current clock-ins from the live HRIS DB, so On Duty is fresh.
  let attendanceUpserted = 0;
  try {
    const att = await runHrisAttendanceSync();
    attendanceUpserted = att.upserted;
    if (att.skipped) {
      console.warn(`[hris-sync-job] attendance sync skipped: ${att.skipped}`);
    }
  } catch (e) {
    console.error("[hris-sync-job] attendance sync failed", e);
  }

  let passwordsUpdated = 0;
  try {
    const pw = await syncHrisPasswordsIntoMerged();
    passwordsUpdated = pw.updated;
  } catch (e) {
    console.error("[hris-sync-job] password sync failed", e);
  }

  // Batch import merged → main users + hris_users snapshot (the only identity hand-off).
  const rows = await readMergedDump();
  const imported = await importMergedUsers(rows, {
    log: (m) => console.log(`[hris-sync-job] ${m}`),
  });
  const synced = imported.created + imported.updated + imported.unchanged;
  const failed = imported.errors.length + imported.conflicts.length;

  try {
    await reconcilePortalStaffRolesFromOrgChart();
  } catch (e) {
    console.warn(
      "[hris-sync-job] org-chart Personnel/Admin reconcile skipped:",
      e instanceof Error ? e.message : e,
    );
  }

  return {
    total: rows.length,
    synced,
    failed,
    durationMs: Date.now() - start,
    mergeUserChanges,
    mergeAttendanceChanges,
    attendanceUpserted,
    passwordsUpdated,
  };
}
