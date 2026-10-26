import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { ModuleDisabledNotice } from "@/components/ModuleDisabledNotice";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { WorkPlansWorkspace } from "@/components/task-board/TravelOrdersQuickAccess";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function WorkPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin?callbackUrl=/work/work-plans");
  if (!(await isSystemModuleEnabled("work_plans"))) return <ModuleDisabledNotice module="work_plans" />;

  const params = await searchParams;
  const focusTravelOrderId = firstQuery(params.plan)?.trim() || null;
  const [operator, perms] = await Promise.all([
    findSessionAgentWithTeam({ email: session.user.email, name: session.user.name }),
    resolveOpsPermissions(session),
  ]);

  return (
    <WorkPlansWorkspace
      operatorAgentId={operator?.id ?? null}
      canAssignWork={Boolean(perms.canAssignWork)}
      focusTravelOrderId={focusTravelOrderId}
    />
  );
}
