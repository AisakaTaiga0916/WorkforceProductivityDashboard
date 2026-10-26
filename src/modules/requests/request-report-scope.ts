/** Ticket scope + filters for Requests → Reports (shared by the page and CSV export). */

import type { Prisma, TicketStatus } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { resolveStaffTicketScope } from "@/lib/dashboard-home";
import { REQUEST_TYPES } from "@/modules/requests/request-types";
import { formatTicketStatusLabel } from "@/modules/requests/ticket-status-label";
import { parseReportRange, type ReportRange } from "@/modules/reports/report-range";
import {
  resolveReportTeamFilter,
  resolveReportViewer,
  type ReportTeamFilter,
  type ReportViewer,
} from "@/modules/reports/report-scope";

const ALL_TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_INFO",
  "ESCALATED",
  "FOR_CONFIRMATION",
  "RESOLVED",
  "CLOSED",
];

/** Status filter options, grouped by board label (e.g. In progress = IN_PROGRESS + PENDING_INFO). */
export const REQUEST_REPORT_STATUS_OPTIONS: Array<{ value: string; label: string; statuses: TicketStatus[] }> =
  ALL_TICKET_STATUSES.reduce<Array<{ value: string; label: string; statuses: TicketStatus[] }>>(
    (acc, status) => {
      const label = formatTicketStatusLabel(status);
      const existing = acc.find((o) => o.label === label);
      if (existing) existing.statuses.push(status);
      else acc.push({ value: status, label, statuses: [status] });
      return acc;
    },
    [],
  );

export const REQUEST_REPORT_TYPE_OPTIONS = REQUEST_TYPES.map((t) => ({ value: t.id, label: t.label }));

export type RequestReportContext = ReportTeamFilter & {
  viewer: ReportViewer;
  range: ReportRange;
  where: Prisma.TicketWhereInput;
  /** `ALL` or a request type id. */
  typeValue: string;
  /** `ALL` or a status option value. */
  statusValue: string;
};

export async function resolveRequestReportContext(
  session: Session,
  params: {
    range?: string | null;
    from?: string | null;
    to?: string | null;
    team?: string | null;
    type?: string | null;
    status?: string | null;
  },
): Promise<RequestReportContext> {
  const viewer = await resolveReportViewer(session);
  const [{ ticketScope }, team] = await Promise.all([
    resolveStaffTicketScope(session),
    resolveReportTeamFilter(viewer, params.team),
  ]);

  const clauses: Prisma.TicketWhereInput[] = [ticketScope];
  // Super Admin scope is global; the shell company (when set) narrows it. Non-global
  // scope already follows the current company and keeps team-routed tickets.
  if (viewer.global && viewer.companyFilterId) clauses.push({ teamId: viewer.companyFilterId });
  if (team.teamAgentIds) {
    clauses.push({
      assignedAgentId: { in: team.teamAgentIds.size > 0 ? [...team.teamAgentIds] : ["__none__"] },
    });
  }
  const typeValue = REQUEST_REPORT_TYPE_OPTIONS.some((o) => o.value === params.type)
    ? params.type!
    : "ALL";
  if (typeValue !== "ALL") clauses.push({ requestType: typeValue });
  const status = REQUEST_REPORT_STATUS_OPTIONS.find((o) => o.value === params.status);
  if (status) clauses.push({ status: { in: status.statuses } });

  return {
    viewer,
    range: parseReportRange({ range: params.range, from: params.from, to: params.to }),
    ...team,
    where: clauses.length === 1 ? ticketScope : { AND: clauses },
    typeValue,
    statusValue: status?.value ?? "ALL",
  };
}
