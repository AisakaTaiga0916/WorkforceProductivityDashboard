"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/vercel-tabs";

export type SuperAdminSettingsTab =
  | "alerts"
  | "access"
  | "faq"
  | "intake"
  | "workforce"
  | "tasks";

const settingsTabs = [
  { id: "alerts", label: "Priority Alerts" },
  { id: "access", label: "Access Controls" },
  { id: "intake", label: "Create Request" },
  { id: "workforce", label: "Workforce" },
  { id: "tasks", label: "Tasks" },
  { id: "faq", label: "FAQ" },
];

export function parseSuperAdminSettingsTab(
  value: string | null | undefined,
): SuperAdminSettingsTab {
  if (value === "access") return "access";
  if (value === "faq") return "faq";
  if (value === "intake") return "intake";
  if (value === "workforce") return "workforce";
  if (value === "tasks") return "tasks";
  return "alerts";
}

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

  function goToTab(tab: SuperAdminSettingsTab) {
    const qs =
      tab === "access"
        ? "?tab=access"
        : tab === "faq"
          ? "?tab=faq"
          : tab === "intake"
            ? "?tab=intake"
            : tab === "workforce"
              ? "?tab=workforce"
              : tab === "tasks"
                ? "?tab=tasks"
                : "?tab=alerts";
    router.replace(`/admin/superadmin-settings${qs}`, { scroll: false });
  }

  return <SuperAdminSettingsNav activeTab={activeTab} onTabChange={goToTab} />;
}
