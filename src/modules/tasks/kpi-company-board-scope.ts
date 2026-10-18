import { hasSubKpiAssignedTo } from "@/modules/tasks/kpi-subkpis";

/**
 * Company board scope: main assignee in company, unassigned card scoped to company,
 * or any sub-task assignee in the company (sub-ids live in JSON).
 */
export function kpiRowInCompanyScope(
  row: {
    assignedAgentId: string | null;
    scopedCompanyTeamId?: string | null;
    subKpis: unknown;
  },
  companyTeamId: string,
  companyAgentIds: Set<string>,
): boolean {
  const companyId = companyTeamId.trim();
  if (!companyId) return false;
  if (row.assignedAgentId && companyAgentIds.has(row.assignedAgentId)) return true;
  if (!row.assignedAgentId && row.scopedCompanyTeamId === companyId) return true;
  for (const agentId of companyAgentIds) {
    if (hasSubKpiAssignedTo(row.subKpis, agentId)) return true;
  }
  return false;
}
