"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui/vercel-tabs";
import { permissionAllows, usePermissions } from "@/modules/platform/rbac/permissions-client";
import { recallReportHref } from "@/lib/report-query-memory";

const adminTabs = [
  { id: "assignment", label: "Assign Requests" },
  { id: "company", label: "Group Board" },
  { id: "ticket", label: "Requests" },
];

const personnelTabs = [{ id: "ticket", label: "Requests" }];

const reportsTab = { id: "reports", label: "Reports" };

export function OrchestrationQueueNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useSession();
  const permissions = usePermissions();
  const role = data?.user?.role;
  const onOrchestration = pathname === "/agent";
  const onAssignment = pathname === "/admin/manual-assignment";
  const onReports = pathname === "/agent/reports";

  const isAdmin = isElevatedPlatformRole(role) || role === "Admin";
  const [fetchedAllow, setFetchedAllow] = useState<boolean | null>(null);

  useEffect(() => {
    if (!role || isAdmin) return;
    if (!["Admin", "Personnel"].includes(role)) {
      queueMicrotask(() => setFetchedAllow(false));
      return;
    }
    let cancelled = false;
    void fetch("/api/me/permissions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { canAccessAssignmentBoard: false }))
      .then((payload: { canAccessAssignmentBoard?: boolean }) => {
        if (!cancelled) setFetchedAllow(!!payload.canAccessAssignmentBoard);
      })
      .catch(() => {
        if (!cancelled) setFetchedAllow(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, isAdmin]);

  const canAccessAssignmentBoard = isAdmin || fetchedAllow === true;
  const showReports = permissionAllows(permissions, "reports.read");
  const board = searchParams.get("board") ?? "ticket";
  const onCompanyBoard = onOrchestration && board === "company";

  if (!onOrchestration && !onAssignment && !onReports) return null;

  const activeTab = onAssignment
    ? "assignment"
    : onReports
      ? "reports"
      : onCompanyBoard
        ? "company"
        : "ticket";

  const goToTab = (tabId: string) => {
    if (tabId === "assignment") {
      router.push("/admin/manual-assignment");
      return;
    }
    if (tabId === "company") {
      router.push("/agent?board=company");
      return;
    }
    if (tabId === "reports") {
      router.push(recallReportHref("/agent/reports"));
      return;
    }
    router.push("/agent?board=ticket");
  };

  const withReports = <T extends { id: string; label: string }>(tabs: T[]) =>
    showReports ? [...tabs, reportsTab] : tabs;

  if (canAccessAssignmentBoard) {
    return (
      <nav className="overflow-x-auto pb-1 sm:pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <Tabs tabs={withReports(adminTabs)} activeTab={activeTab} onTabChange={goToTab} />
      </nav>
    );
  }

  if (onAssignment) return null;

  return (
    <nav className="overflow-x-auto pb-1 sm:pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <Tabs tabs={withReports(personnelTabs)} activeTab={activeTab} onTabChange={goToTab} />
    </nav>
  );
}
