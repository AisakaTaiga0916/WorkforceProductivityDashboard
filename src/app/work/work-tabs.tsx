"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { recallReportHref } from "@/lib/report-query-memory";
import { cn } from "@/lib/cn";
import { WORK_TAB_ACTIONS_ID } from "@/components/WorkTabActions";
import { useSystemModules } from "@/modules/platform/settings/system-modules-client";
import { permissionAllows, usePermissions } from "@/modules/platform/rbac/permissions-client";

const TABS = [
  { id: "tasks", href: "/work/tasks", label: "Tasks" },
  { id: "projects", href: "/work/projects", label: "Projects" },
  { id: "work_plans", href: "/work/work-plans", label: "Work Plans" },
] as const;

export function WorkTabs() {
  const pathname = usePathname();
  const modules = useSystemModules();
  const permissions = usePermissions();
  // Reopen Reports with the filters last used this session (lens, period, team…).
  const [reportsHref, setReportsHref] = useState("/work/reports");
  useEffect(() => {
    queueMicrotask(() => setReportsHref(recallReportHref("/work/reports")));
  }, [pathname]);
  const visible: Array<{ id: string; href: string; label: string; match: string }> = TABS.filter(
    (tab) => modules[tab.id],
  ).map((tab) => ({ ...tab, match: tab.href }));
  // Reports segregates the module lenses; shown while any Work module is on.
  if (visible.length > 0 && permissionAllows(permissions, "reports.read")) {
    visible.push({ id: "reports", href: reportsHref, label: "Reports", match: "/work/reports" });
  }
  const actionsSlot = (
    <div id={WORK_TAB_ACTIONS_ID} className="ml-auto flex items-center gap-2 pb-1.5" />
  );
  if (visible.length <= 1) return <div className="flex items-center">{actionsSlot}</div>;

  return (
    <div className="flex flex-wrap items-end gap-x-3 border-b border-zinc-200 dark:border-zinc-800">
      <nav aria-label="Work sections" className="flex items-center gap-1">
        {visible.map((tab) => {
          const active = pathname === tab.match || pathname.startsWith(`${tab.match}/`);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                active
                  ? "border-orange-600 text-orange-700 dark:border-orange-400 dark:text-orange-300"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {actionsSlot}
    </div>
  );
}
