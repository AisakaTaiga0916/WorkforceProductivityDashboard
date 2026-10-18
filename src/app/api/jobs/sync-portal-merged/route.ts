import { NextResponse } from "next/server";

import { runPortalToMergedSync } from "@/modules/platform/auth/portal-to-merged-sync";
import { runComputeUserEfficiencyBreakdowns } from "@/modules/tasks/efficiency/user-efficiency-breakdown";
import { runPortalWorkToMergedSync } from "@/lib/sync/portal-work-to-merged";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const configured = process.env.INTERNAL_JOB_KEY?.trim();
  if (!configured) return false;
  return req.headers.get("x-internal-job-key") === configured;
}

/**
 * POST /api/jobs/sync-portal-merged — ongoing sync from the primary
 * (ticketing_system_v3) source: PortalAccount → merged_users, then task
 * progress / KPI snapshots / per-user averages, then the current-period
 * efficiency breakdowns.
 */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await runPortalToMergedSync({ dryRun: false });
  const work = await runPortalWorkToMergedSync({ dryRun: false });

  let efficiency: unknown = null;
  try {
    efficiency = await runComputeUserEfficiencyBreakdowns({
      dryRun: false,
      frequencies: ["MONTHLY", "WEEKLY"],
      lookbackPeriods: 2,
    });
  } catch (e) {
    console.error("[sync-portal-merged] efficiency breakdown refresh failed", e);
    efficiency = { error: "failed, see server logs" };
  }

  return NextResponse.json(
    { users, work, efficiency },
    { headers: { "cache-control": "no-store" } },
  );
}
