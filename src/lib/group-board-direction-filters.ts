import type { Prisma } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import { filterOrgChartSectionsByCompanyTeam } from "@/lib/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/lib/org-chart-section-roster";
import { expandOrgChartSectionIdsWithDescendants } from "@/lib/org-chart-section-scope";

/** Encoded Group Board direction filter: company:<teamId> | dept:<sectionId> */
export type GroupBoardDirectionFilter =
  | { kind: "company"; id: string }
  | { kind: "dept"; id: string };

export function parseGroupBoardDirectionFilter(
  raw: string | null | undefined,
): GroupBoardDirectionFilter | null {
  const value = (raw ?? "").trim();
  if (!value || value === "ALL") return null;
  if (value.startsWith("company:")) {
    const id = value.slice("company:".length).trim();
    return id ? { kind: "company", id } : null;
  }
  if (value.startsWith("dept:")) {
    const id = value.slice("dept:".length).trim();
    return id ? { kind: "dept", id } : null;
  }
  return null;
}

export function encodeGroupBoardDirectionFilter(
  filter: GroupBoardDirectionFilter | null | undefined,
): string | null {
  if (!filter) return null;
  return filter.kind === "company" ? `company:${filter.id}` : `dept:${filter.id}`;
}

export function buildGroupBoardDirectionFilterOptions(opts: {
  companies: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; depth: number }>;
}): Array<{ value: string; label: string }> {
  const companyOpts = opts.companies.map((t) => ({
    value: `company:${t.id}`,
    label: `Company · ${t.name}`,
  }));
  const deptOpts = opts.sections.map((s) => ({
    value: `dept:${s.id}`,
    label: `Dept · ${s.name}`,
  }));
  return [
    { value: "ALL", label: "All" },
    ...companyOpts,
    ...deptOpts,
  ];
}

function appendAnd(
  base: Prisma.TicketWhereInput,
  clause: Prisma.TicketWhereInput | null | undefined,
) {
  if (!clause || Object.keys(clause).length === 0) return;
  const existing = base.AND;
  const list = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
  list.push(clause);
  base.AND = list;
}

async function sectionIdsForCompanyTeam(companyTeamId: string): Promise<string[]> {
  const all = await listOrgChartSectionOptions();
  return filterOrgChartSectionsByCompanyTeam(all, companyTeamId).map((s) => s.id);
}

async function emailsForCompanyTeam(companyTeamId: string): Promise<string[]> {
  const portals = await prisma.portalAccount.findMany({
    where: {
      OR: [
        { staffDesignatedCompanyId: companyTeamId },
        { companyId: companyTeamId },
      ],
    },
    select: { email: true },
    take: 5000,
  });
  return [
    ...new Set(
      portals
        .map((p) => p.email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Requests received = send-to company/department. */
export async function ticketWhereForGroupBoardReceived(
  filter: GroupBoardDirectionFilter,
): Promise<Prisma.TicketWhereInput> {
  if (filter.kind === "dept") {
    const ids = await expandOrgChartSectionIdsWithDescendants([filter.id]);
    if (ids.length === 0) return { id: "__none__" };
    return { orgChartSectionId: { in: ids } };
  }

  const sectionIds = await sectionIdsForCompanyTeam(filter.id);
  const clauses: Prisma.TicketWhereInput[] = [
    { teamId: filter.id },
  ];
  if (sectionIds.length > 0) {
    clauses.push({ orgChartSectionId: { in: sectionIds } });
  }
  return { OR: clauses };
}

/** Requests sent by = requestor company/department. */
export async function ticketWhereForGroupBoardSentBy(
  filter: GroupBoardDirectionFilter,
): Promise<Prisma.TicketWhereInput> {
  if (filter.kind === "dept") {
    const ids = await expandOrgChartSectionIdsWithDescendants([filter.id]);
    if (ids.length === 0) return { id: "__none__" };
    return { requestorOrgChartSectionId: { in: ids } };
  }

  const [emails, sectionIds] = await Promise.all([
    emailsForCompanyTeam(filter.id),
    sectionIdsForCompanyTeam(filter.id),
  ]);
  const clauses: Prisma.TicketWhereInput[] = [];
  if (emails.length > 0) {
    clauses.push(
      { requestorEmail: { in: emails } },
      { contactEmail: { in: emails } },
    );
  }
  if (sectionIds.length > 0) {
    clauses.push({ requestorOrgChartSectionId: { in: sectionIds } });
  }
  if (clauses.length === 0) return { id: "__none__" };
  return { OR: clauses };
}

/** AND sent-by / received filters onto an existing ticket where. */
export async function applyGroupBoardDirectionFilters(
  ticketWhereBase: Prisma.TicketWhereInput,
  opts: {
    sentBy?: GroupBoardDirectionFilter | null;
    received?: GroupBoardDirectionFilter | null;
  },
): Promise<void> {
  if (opts.sentBy) {
    appendAnd(ticketWhereBase, await ticketWhereForGroupBoardSentBy(opts.sentBy));
  }
  if (opts.received) {
    appendAnd(ticketWhereBase, await ticketWhereForGroupBoardReceived(opts.received));
  }
}
