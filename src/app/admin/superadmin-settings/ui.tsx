"use client";

import type { EscalationTrigger } from "@prisma/client/primary";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SuperAdminSettingsNav, type SuperAdminSettingsTab } from "@/components/SuperAdminSettingsNav";
import { BRAND_TITLE } from "@/lib/brand";
import { superAdminSettingsHref } from "@/lib/superadmin-settings-tabs";
import { RolesPanel } from "./RolesPanel";
import { SystemSettingsPanel } from "./SystemSettingsPanel";
import { UsersPanel } from "./UsersPanel";

type Trigger = Pick<
  EscalationTrigger,
  "id" | "priority" | "enabled" | "notifyAdmin" | "notifyTarget"
>;

export function SuperAdminSettingsClient({
  initialTab,
  initialTriggers,
}: {
  initialTab: SuperAdminSettingsTab;
  initialTriggers: Trigger[];
}) {
  const router = useRouter();
  const [tab, setTabState] = useState<SuperAdminSettingsTab>(initialTab);

  useEffect(() => {
    setTabState(initialTab);
  }, [initialTab]);

  function setTab(next: SuperAdminSettingsTab) {
    setTabState(next);
    router.replace(superAdminSettingsHref(next), { scroll: false });
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
            Manage roles and permissions, users, and system settings (modules, priority alerts,
            task verification). The organizational chart lives under Workforce → Org. Chart.
          </p>
        </div>
        <SuperAdminSettingsNav activeTab={tab} onTabChange={setTab} />
      </header>

      {tab === "users" ? (
        <UsersPanel />
      ) : tab === "system" ? (
        <SystemSettingsPanel initialTriggers={initialTriggers} />
      ) : (
        <RolesPanel />
      )}
    </main>
  );
}
