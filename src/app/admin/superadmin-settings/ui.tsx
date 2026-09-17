"use client";

import type { EscalationTrigger } from "@prisma/client/primary";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SuperAdminSettingsNav, type SuperAdminSettingsTab } from "@/components/SuperAdminSettingsNav";
import { BRAND_TITLE } from "@/lib/brand";
import { EscalationTriggersClient } from "../escalation-triggers/ui";
import { AccessControlsPanel } from "./AccessControlsPanel";
import { FaqPanel } from "./FaqPanel";
import { IntakeRequestTypesPanel } from "./IntakeRequestTypesPanel";
import { TaskVerificationPanel } from "./TaskVerificationPanel";
import { WorkforceViewsPanel } from "./WorkforceViewsPanel";

type Trigger = Pick<
  EscalationTrigger,
  "id" | "priority" | "enabled" | "notifyAdmin" | "notifyTarget"
>;

export function SuperAdminSettingsClient({
  initialTab,
  initialTriggers,
  maxOrgLayer,
}: {
  initialTab: SuperAdminSettingsTab;
  initialTriggers: Trigger[];
  /** Deepest layer currently on the org chart — labels the access matrix. */
  maxOrgLayer: number;
}) {
  const router = useRouter();
  const [tab, setTabState] = useState<SuperAdminSettingsTab>(initialTab);

  useEffect(() => {
    setTabState(initialTab);
  }, [initialTab]);

  function setTab(next: SuperAdminSettingsTab) {
    setTabState(next);
    const qs =
      next === "access"
        ? "?tab=access"
        : next === "faq"
          ? "?tab=faq"
          : next === "intake"
            ? "?tab=intake"
            : next === "workforce"
              ? "?tab=workforce"
              : next === "tasks"
                ? "?tab=tasks"
                : "?tab=alerts";
    router.replace(`/admin/superadmin-settings${qs}`, { scroll: false });
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10">
      <header className="panel space-y-4 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-400/95">
            {BRAND_TITLE} · SuperAdmin Settings
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            SuperAdmin Settings
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Manage escalation alerts, access controls, task verification, Workforce toggles, and the
            public sign-in FAQ. The organizational chart lives under Workforce → Org. Chart when that
            toggle is shown.
          </p>
        </div>
        <SuperAdminSettingsNav activeTab={tab} onTabChange={setTab} />
      </header>

      {tab === "access" ? (
        <AccessControlsPanel maxOrgLayer={maxOrgLayer} />
      ) : tab === "intake" ? (
        <IntakeRequestTypesPanel />
      ) : tab === "workforce" ? (
        <WorkforceViewsPanel />
      ) : tab === "tasks" ? (
        <TaskVerificationPanel />
      ) : tab === "faq" ? (
        <FaqPanel />
      ) : (
        <EscalationTriggersClient initialTriggers={initialTriggers} embedded />
      )}
    </main>
  );
}
