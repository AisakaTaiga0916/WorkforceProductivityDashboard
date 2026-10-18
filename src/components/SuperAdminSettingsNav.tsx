"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/vercel-tabs";
import {
  SUPERADMIN_SETTINGS_TABS,
  parseSuperAdminSettingsTab,
  superAdminSettingsHref,
  type SuperAdminSettingsTab,
} from "@/lib/superadmin-settings-tabs";

export type { SuperAdminSettingsTab };

const settingsTabs = SUPERADMIN_SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label }));

export function SuperAdminSettingsNav({
  activeTab,
  onTabChange,
}: {
  activeTab: SuperAdminSettingsTab;
  onTabChange: (tab: SuperAdminSettingsTab) => void;
}) {
  return (
    <nav className="overflow-x-auto pb-1 sm:pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <Tabs
        tabs={settingsTabs}
        activeTab={activeTab}
        onTabChange={(tabId) => onTabChange(parseSuperAdminSettingsTab(tabId))}
      />
    </nav>
  );
}

/** Standalone nav that reads/writes ?tab= in the URL (for pages that do not manage tab state locally). */
export function SuperAdminSettingsNavFromUrl() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseSuperAdminSettingsTab(searchParams.get("tab"));

  return (
    <SuperAdminSettingsNav
      activeTab={activeTab}
      onTabChange={(tab) => router.replace(superAdminSettingsHref(tab), { scroll: false })}
    />
  );
}
