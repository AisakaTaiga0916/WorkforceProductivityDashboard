/**
 * Workforce Org. Chart in a company context.
 *
 * Teams (`org_chart_sections`) belong to one company, but the chart is group-wide:
 * a team's parent may sit in another company. In company A we show A's teams plus
 * their parent chain (structure context), and A's people plus their reports-to
 * chain, so the tree stays connected without exposing unrelated companies' teams.
 */

import { prisma } from "@/modules/platform/db/prisma";

type ScopeSection = {
  id: string;
  parentId: string | null;
  companyTeamId: string | null;
  headNodeId: string | null;
  reportsToNodeId: string | null;
};

type ScopeNode = {
  id: string;
  parentId: string | null;
  mergedSourceUserId: string;
  sectionId: string | null;
  sectionMemberships?: ReadonlyArray<{ sectionId: string }>;
};

function withAncestors<T extends { id: string; parentId: string | null }>(
  seeds: Iterable<string>,
  rows: readonly T[],
): Set<string> {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const out = new Set<string>();
  for (const seed of seeds) {
    let current: string | null = seed;
    while (current && byId.has(current) && !out.has(current)) {
      out.add(current);
      current = byId.get(current)!.parentId;
    }
  }
  return out;
}

export function scopeOrgChartToCompany(input: {
  companyId: string;
  sections: readonly ScopeSection[];
  nodes: readonly ScopeNode[];
  /** HRIS ids of people with a membership in the company. */
  companyMemberMergedIds: ReadonlySet<string>;
}): { sectionIds: Set<string>; nodeIds: Set<string> } {
  const companySections = input.sections.filter((s) => s.companyTeamId === input.companyId);
  const companySectionIds = new Set(companySections.map((s) => s.id));
  const sectionIds = withAncestors(companySectionIds, input.sections);

  const seedNodes = new Set<string>();
  for (const section of companySections) {
    if (section.headNodeId) seedNodes.add(section.headNodeId);
    if (section.reportsToNodeId) seedNodes.add(section.reportsToNodeId);
  }
  for (const node of input.nodes) {
    const inCompanyTeam =
      (node.sectionId != null && companySectionIds.has(node.sectionId)) ||
      (node.sectionMemberships ?? []).some((m) => companySectionIds.has(m.sectionId));
    if (inCompanyTeam || input.companyMemberMergedIds.has(node.mergedSourceUserId.trim())) {
      seedNodes.add(node.id);
    }
  }
  return { sectionIds, nodeIds: withAncestors(seedNodes, input.nodes) };
}

/** HRIS (merged) ids of everyone with a membership in `companyId`. */
export async function loadMergedIdsWithCompanyMembership(companyId: string): Promise<Set<string>> {
  const rows = await prisma.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null }, companyMemberships: { some: { companyId } } },
    select: { mergedSourceUserId: true },
  });
  return new Set(
    rows.map((r) => r.mergedSourceUserId?.toString()).filter((id): id is string => Boolean(id)),
  );
}
