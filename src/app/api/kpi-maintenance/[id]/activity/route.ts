import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { listKpiActivities } from "@/modules/tasks/kpi-activity";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import {
  collectChecklistProgressItems,
  subKpiAssignedAgentId,
} from "@/modules/tasks/kpi-subkpis";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { itProjectAllItems, parseItProjectSubKpis } from "@/modules/tasks/it-project-subkpis";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const { id } = await ctx.params;
  const row = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      mainTask: true,
      assignedAgentId: true,
      subKpis: true,
      itProjectPhase: true,
    },
  });
  if (!row) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const perms = await resolveOpsPermissions(session);
  const isMainAssignee = !!perms.operator && perms.operator.id === row.assignedAgentId;
  const items = isItProjectImplementationPillar(row.title)
    ? itProjectAllItems(parseItProjectSubKpis(row.subKpis, row.itProjectPhase))
    : collectChecklistProgressItems(row.subKpis, kpiMainTaskLabel(row));
  const isSubAssignee =
    !!perms.operator &&
    items.some((item) => subKpiAssignedAgentId(item) === perms.operator?.id);

  if (!(perms.canAssignWork || isMainAssignee || isSubAssignee)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const takeParam = Number.parseInt(new URL(req.url).searchParams.get("take") ?? "40", 10);
  const take = Number.isFinite(takeParam) ? takeParam : 40;
  const rows = await listKpiActivities(id, take);
  return NextResponse.json({ rows });
}
