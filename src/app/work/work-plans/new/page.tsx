import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { ModuleDisabledNotice } from "@/components/ModuleDisabledNotice";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { NewWorkPlanWizard } from "./new-work-plan-wizard";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function NewWorkPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin?callbackUrl=/work/work-plans/new");
  if (!(await isSystemModuleEnabled("work_plans"))) return <ModuleDisabledNotice module="work_plans" />;

  const params = await searchParams;
  const resumeDraftId = firstQuery(params.draft)?.trim() || null;
  const operator = await findSessionAgentWithTeam({
    email: session.user.email,
    name: session.user.name,
  });

  return (
    <NewWorkPlanWizard
      // Remount when switching drafts so the wizard reloads the chosen draft.
      key={resumeDraftId ?? "new"}
      operatorAgentId={operator?.id ?? null}
      resumeDraftId={resumeDraftId}
    />
  );
}
