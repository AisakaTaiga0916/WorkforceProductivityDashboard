import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { isElevatedUserRole } from "@/lib/auth";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/lib/prisma";
import { resolveAgentDesignatedCompanyId } from "@/lib/staff-company-scope";
import { isPersonnelGuardPortalRole } from "@/lib/staff-role";
import {
  findTravelOrdersVisibleToAgent,
  serializeTravelOrder,
} from "@/lib/travel-order-db";

/** Dev/Windows: add work_plan_meta if migrations have not run yet. */
let workPlanMetaColumnReady = false;
async function ensureWorkPlanMetaColumn(): Promise<void> {
  if (workPlanMetaColumnReady) return;
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "travel_orders" ADD COLUMN IF NOT EXISTS "work_plan_meta" JSONB;
    `);
  } catch {
    /* ignore — list still runs; missing column is handled by query fallback */
  } finally {
    workPlanMetaColumnReady = true;
  }
}

/**
 * GET /api/travel-orders
 * Lists travel orders where the caller is requestor, traveler/driver,
 * designated approver, or confirmer (not company-wide).
 * Personnel-Guard sees all APPROVED (running) trips for Gate Pass capture.
 * Elevated admins without an agent row get the platform-wide list.
 */
export async function GET() {
  const { session, unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
    "Personnel-Guard",
  ]);
  if (unauthorized || !session) return unauthorized;

  try {
    await ensureWorkPlanMetaColumn();
    const perms = await resolveOpsPermissions(session);
    const gatePassOnly = isPersonnelGuardPortalRole(session.user.role);

    const operatorId = perms.operator?.id ?? null;
    // SuperAdmin / HighAdmin have no agent row and no company scope — give them the
    // full platform list instead of an empty one.
    const allVisible = !operatorId && isElevatedUserRole(session.user.role);
    if (!operatorId && !allVisible) {
      return NextResponse.json({ travelOrders: [], companyTeamId: null });
    }

    const companyTeamId = gatePassOnly
      ? null
      : await resolveAgentDesignatedCompanyId(operatorId ?? "").catch(async (err) => {
          console.warn("[api/travel-orders] designated company lookup failed:", err);
          if (!operatorId) return null;
          const agent = await prisma.agent.findUnique({
            where: { id: operatorId },
            select: { teamId: true },
          });
          return agent?.teamId ?? null;
        });
    const rows = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: operatorId,
      gatePassOnly,
      allVisible,
    });
    return NextResponse.json(
      {
        companyTeamId,
        travelOrders: rows.map(serializeTravelOrder),
      },
      {
        headers: {
          // Role-scoped payload — never let browsers/SW reuse another role's list.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err) {
    console.error("[api/travel-orders] list failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not load travel orders.",
      },
      { status: 500 },
    );
  }
}
