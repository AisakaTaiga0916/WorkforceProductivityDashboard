/** Shared report scope: report permissions + company context (from the shell switcher). */

import type { Session } from "next-auth";
import { hasPermission, permissionSubjectFromSession } from "@/modules/platform/rbac/permissions";
import { buildOrgChartDepartmentFilterOptions } from "@/modules/hierarchy/org-chart-section-display";
import {
  listOrgChartSectionOptions,
  resolveAgentIdsForOrgChartSection,
} from "@/modules/hierarchy/org-chart-section-roster";
import { getCompanyAccess } from "@/modules/platform/scope/company-access";

export type ReportViewer = {
  canRead: boolean;
  canExport: boolean;
  /** Global viewers (Super Admin) may pick "All companies" in the shell switcher. */
  global: boolean;
  /**
   * Company from the shell switcher — reports never add a second company picker.
   * null = "All companies" (global only); `__none__` when a member has no company.
   */
  companyFilterId: string | null;
  /** Read-only readout for the filter bar ("All companies" or the company name). */
  companyLabel: string;
  /** Name of the current company, or null for "All companies". */
  companyName: string | null;
  /** "All companies" (global): summary counts only — per-person breakdowns need one company. */
  allCompanies: boolean;
};

export async function resolveReportViewer(session: Session): Promise<ReportViewer> {
  const subject = permissionSubjectFromSession(session);
  const [canRead, canExport, access] = await Promise.all([
    hasPermission(subject, "reports.read"),
    hasPermission(subject, "reports.export"),
    getCompanyAccess(session),
  ]);
  const current = access.companies.find((c) => c.id === access.currentCompanyId) ?? null;
  const allCompanies = access.global && !current;
  return {
    canRead,
    canExport,
    global: access.global,
    companyFilterId: current?.id ?? (access.global ? null : "__none__"),
    companyLabel: current?.name ?? (allCompanies ? "All companies" : "No company"),
    companyName: current?.name ?? null,
    allCompanies,
  };
}

export type ReportTeamFilter = {
  teams: Array<{ value: string; label: string }>;
  teamId: string | null;
  /** Agent ids in the selected team (incl. sub-teams), or null for no team filter. */
  teamAgentIds: Set<string> | null;
};

/** Teams of the current company (none for "All companies") + the validated selection. */
export async function resolveReportTeamFilter(
  viewer: ReportViewer,
  requestedTeam: string | null | undefined,
): Promise<ReportTeamFilter> {
  const companyId =
    viewer.companyFilterId && viewer.companyFilterId !== "__none__" ? viewer.companyFilterId : null;
  if (!companyId) return { teams: [], teamId: null, teamAgentIds: null };
  const teams = buildOrgChartDepartmentFilterOptions(await listOrgChartSectionOptions(), companyId);
  const wanted = requestedTeam?.trim();
  const teamId = wanted && teams.some((t) => t.value === wanted) ? wanted : null;
  const teamAgentIds = teamId ? new Set(await resolveAgentIdsForOrgChartSection(teamId)) : null;
  return { teams, teamId, teamAgentIds };
}

/** Query string for report links (range + filters). */
export function reportQuery(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "" && value !== "ALL") search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
