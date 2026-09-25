/**
 * Work Plan approval recommendations: walk the requestor's org-chart parents
 * from the layer above them up to Layer 2 (Layer 1 is excluded), and insert
 * parent-section heads (sub-department → major) so intermediate managers are
 * not skipped when the people chart jumps directly to a major head.
 */

import { orgChartLayerById, orgChartReportingParentByNodeId } from "@/app/admin/superadmin-settings/org-chart-layers";
import { resolveMergedSourceUserIdForAgent } from "@/lib/approval-position-resolver";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import {
  pickDeepestOrgChartSectionId,
  resolveDepartmentDesignationsByMergedIds,
  resolveOrgChartSectionContext,
  resolveOrgChartSectionIdsForMergedUser,
} from "@/lib/org-chart-section-roster";
import { prisma } from "@/lib/prisma";
import { resolveAgentDesignatedCompanyId } from "@/lib/staff-company-scope";
import {
  buildTravelOrderRecommendedPath,
  buildTravelOrderRecommendedPathFromChain,
  mergeTravelOrderApprovalAncestors,
  type TravelOrderOrgChartAncestor,
  type TravelOrderOrgChartPathSeat,
} from "@/lib/travel-order";
import {
  WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
  type WorkPlanRequestorDefaults,
} from "@/lib/work-plan";
import type { TravelOrderRecommendedConfirmer } from "@/lib/travel-order-org-chart-path";

const AUDIT_COMMITTEE_SECTION_RE = /^audit\s*committee$/i;
const INTERNAL_AUDIT_SECTION_RE = /^internal\s*audit$/i;

/**
 * When Audit Committee head is in the chain, ensure Internal Audit head
 * (Ailyn Silana) sits immediately before them: Ailyn → Juan Miguel.
 */
export function ensureInternalAuditBeforeAuditCommittee(opts: {
  ancestors: readonly TravelOrderOrgChartAncestor[];
  requestorAgentId: string;
  sections: Array<{
    id: string;
    name: string;
    parentId: string | null;
    headNodeId: string | null;
  }>;
  nodeById: Map<
    string,
    { id: string; mergedSourceUserId: string; personName: string | null }
  >;
  agentByMergedId: Map<string, { agentId: string; name: string }>;
  layerByNodeId: Map<string, number>;
}): TravelOrderOrgChartAncestor[] {
  const auditCommittee = opts.sections.find((s) =>
    AUDIT_COMMITTEE_SECTION_RE.test(s.name.trim()),
  );
  const internalAudit = opts.sections.find(
    (s) =>
      INTERNAL_AUDIT_SECTION_RE.test(s.name.trim()) &&
      (!auditCommittee || s.parentId === auditCommittee.id),
  );
  if (!auditCommittee?.headNodeId || !internalAudit?.headNodeId) {
    return [...opts.ancestors];
  }

  const auditHeadNode = opts.nodeById.get(auditCommittee.headNodeId);
  const internalHeadNode = opts.nodeById.get(internalAudit.headNodeId);
  const auditMerged = auditHeadNode?.mergedSourceUserId?.trim() || "";
  const internalMerged = internalHeadNode?.mergedSourceUserId?.trim() || "";
  if (!auditMerged || !internalMerged) return [...opts.ancestors];

  const auditStaff = opts.agentByMergedId.get(auditMerged);
  const internalStaff = opts.agentByMergedId.get(internalMerged);
  const auditAgentId = auditStaff?.agentId ?? null;
  const internalAgentId = internalStaff?.agentId ?? null;

  const matches = (
    ancestor: TravelOrderOrgChartAncestor,
    agentId: string | null,
    mergedId: string,
  ) =>
    Boolean(
      (agentId && ancestor.agentId === agentId) ||
        ancestor.mergedSourceUserId === mergedId,
    );

  const auditIdx = opts.ancestors.findIndex((a) =>
    matches(a, auditAgentId, auditMerged),
  );
  // Audit Committee not in this recommendation path — leave chain alone.
  if (auditIdx < 0) return [...opts.ancestors];

  // Requestor is Internal Audit head — do not recommend themselves.
  if (internalAgentId && internalAgentId === opts.requestorAgentId) {
    return [...opts.ancestors];
  }

  const withoutInternal = opts.ancestors.filter(
    (a) => !matches(a, internalAgentId, internalMerged),
  );
  const insertAt = withoutInternal.findIndex((a) =>
    matches(a, auditAgentId, auditMerged),
  );
  if (insertAt < 0) return withoutInternal;

  const internalAncestor: TravelOrderOrgChartAncestor = {
    orgChartLayer:
      (internalHeadNode?.id
        ? opts.layerByNodeId.get(internalHeadNode.id)
        : undefined) ?? WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
    agentId: internalAgentId,
    agentName:
      internalStaff?.name?.trim() ||
      internalHeadNode?.personName?.trim() ||
      null,
    mergedSourceUserId: internalMerged,
    alternateAgents: [],
  };

  const out = [...withoutInternal];
  out.splice(insertAt, 0, internalAncestor);
  return out;
}

export type WorkPlanOrgChartApprovalPath = {
  requestorAgentId: string;
  requestorOrgLayer: number | null;
  seats: TravelOrderOrgChartPathSeat[];
  /** True when no seats could be filled, or requestor is already at Layer 2 or above. */
  usedFallback: boolean;
  /** Prefill Requesting Party, PIC, and Personnel Involved. */
  defaults: WorkPlanRequestorDefaults;
  /** Department head for To be Confirmed by. */
  recommendedConfirmation: TravelOrderRecommendedConfirmer;
};

function emptyConfirmer(): TravelOrderRecommendedConfirmer {
  return {
    agentId: null,
    agentName: null,
    sectionId: null,
    sectionName: null,
    hint: null,
  };
}

function confirmerFromDefaults(
  defaults: WorkPlanRequestorDefaults,
  confirmerSectionName?: string | null,
): TravelOrderRecommendedConfirmer {
  const agentId = defaults.departmentHeadAgentId?.trim() || null;
  const sectionName =
    confirmerSectionName?.trim() ||
    defaults.sectionName?.trim() ||
    defaults.majorSectionName?.trim() ||
    null;
  if (!agentId && !defaults.departmentHeadName?.trim()) return emptyConfirmer();
  return {
    agentId,
    agentName: defaults.departmentHeadName?.trim() || null,
    sectionId: null,
    sectionName,
    hint: sectionName ? `Department head — ${sectionName}` : "Department head",
  };
}

function emptyDefaults(
  partial?: Partial<WorkPlanRequestorDefaults>,
): WorkPlanRequestorDefaults {
  return {
    requestorAgentId: partial?.requestorAgentId ?? "",
    requestorName: partial?.requestorName ?? null,
    requestorRole: partial?.requestorRole ?? null,
    sectionName: partial?.sectionName ?? null,
    majorSectionName: partial?.majorSectionName ?? null,
    designatedCompanyName: partial?.designatedCompanyName ?? null,
    departmentHeadAgentId: partial?.departmentHeadAgentId ?? null,
    departmentHeadName: partial?.departmentHeadName ?? null,
  };
}

function emptyFallbackSeat(): TravelOrderOrgChartPathSeat {
  return {
    sequenceLevel: 1,
    orgChartLayer: WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
    label: "Approved by",
    hint: "Assign an approver.",
    recommendedOptional: false,
    agentId: null,
    agentName: null,
    mergedSourceUserId: null,
    alternateAgents: [],
  };
}

type StaffRow = { agentId: string; name: string; mergedSourceUserId: string };

/**
 * Walk section parents from the requestor's deepest membership and collect each
 * section head who is not the requestor (e.g. sub-dept staff → Engelbert → …).
 */
async function resolveSectionHeadAncestors(opts: {
  requestorAgentId: string;
  mergedSourceUserId: string | null;
  agentByMergedId: Map<string, { agentId: string; name: string }>;
  layerByNodeId: Map<string, number>;
  nodeById: Map<string, { id: string; mergedSourceUserId: string; personName: string | null }>;
}): Promise<{
  sectionHeads: TravelOrderOrgChartAncestor[];
  departmentHeadAgentId: string | null;
  departmentHeadName: string | null;
  confirmerSectionName: string | null;
  sectionName: string | null;
  majorSectionName: string | null;
}> {
  const empty = {
    sectionHeads: [] as TravelOrderOrgChartAncestor[],
    departmentHeadAgentId: null as string | null,
    departmentHeadName: null as string | null,
    confirmerSectionName: null as string | null,
    sectionName: null as string | null,
    majorSectionName: null as string | null,
  };
  if (!opts.mergedSourceUserId) return empty;

  const sectionIds = await resolveOrgChartSectionIdsForMergedUser(opts.mergedSourceUserId);
  const deepestId = await pickDeepestOrgChartSectionId(sectionIds);
  const context = deepestId ? await resolveOrgChartSectionContext(deepestId) : null;
  const section = context?.selected ?? null;
  const major = context?.main ?? section;

  const sectionHeads: TravelOrderOrgChartAncestor[] = [];
  let departmentHeadAgentId: string | null = null;
  let departmentHeadName: string | null = null;
  let confirmerSectionName: string | null = null;
  let current = section;
  const visiting = new Set<string>();

  while (current && !visiting.has(current.id)) {
    visiting.add(current.id);
    if (current.headNodeId) {
      const headNode =
        opts.nodeById.get(current.headNodeId) ??
        (await prisma.orgChartNode.findUnique({
          where: { id: current.headNodeId },
          select: { id: true, mergedSourceUserId: true, personName: true },
        }));
      const merged = headNode?.mergedSourceUserId?.trim() || "";
      if (merged) {
        const headStaff = opts.agentByMergedId.get(merged);
        const headAgentId = headStaff?.agentId ?? null;
        // Skip the requestor when they head their own sub-department — keep walking
        // to the parent section (e.g. Rogeric → Engelbert).
        if (headAgentId && headAgentId !== opts.requestorAgentId) {
          const layer =
            (headNode?.id ? opts.layerByNodeId.get(headNode.id) : undefined) ??
            WORK_PLAN_APPROVAL_TOP_ORG_LAYER;
          sectionHeads.push({
            orgChartLayer: layer,
            agentId: headAgentId,
            agentName: headStaff?.name?.trim() || headNode?.personName?.trim() || null,
            mergedSourceUserId: merged,
            alternateAgents: [],
          });
          if (!departmentHeadAgentId) {
            departmentHeadAgentId = headAgentId;
            departmentHeadName =
              headStaff?.name?.trim() || headNode?.personName?.trim() || null;
            confirmerSectionName = current.name?.trim() || null;
          }
        }
      }
    }
    if (!current.parentId) break;
    current = await prisma.orgChartSection.findUnique({
      where: { id: current.parentId },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
  }

  return {
    sectionHeads,
    departmentHeadAgentId,
    departmentHeadName,
    confirmerSectionName,
    sectionName: section?.name?.trim() || null,
    majorSectionName: major?.name?.trim() || null,
  };
}

async function resolveWorkPlanRequestorDefaults(
  requestorAgentId: string,
  mergedSourceUserId: string | null,
  staff: StaffRow[],
  designatedCompanyTeamId: string | null | undefined,
  sectionContext: {
    sectionName: string | null;
    majorSectionName: string | null;
    departmentHeadAgentId: string | null;
    departmentHeadName: string | null;
  },
): Promise<WorkPlanRequestorDefaults> {
  const staffRow = staff.find((s) => s.agentId === requestorAgentId) ?? null;

  let requestorRole: string | null = null;
  let requestorName = staffRow?.name?.trim() || null;
  if (mergedSourceUserId) {
    const node = await prisma.orgChartNode.findUnique({
      where: { mergedSourceUserId },
      select: { personName: true, personRole: true },
    });
    if (node?.personRole?.trim()) requestorRole = node.personRole.trim();
    if (!requestorName && node?.personName?.trim()) requestorName = node.personName.trim();
  }

  let designatedCompanyName: string | null = null;
  const companyTeamId =
    designatedCompanyTeamId?.trim() ||
    (await resolveAgentDesignatedCompanyId(requestorAgentId));
  if (companyTeamId) {
    const team = await prisma.team.findUnique({
      where: { id: companyTeamId },
      select: { name: true },
    });
    designatedCompanyName = team?.name?.trim() || null;
  }

  return emptyDefaults({
    requestorAgentId,
    requestorName,
    requestorRole,
    sectionName: sectionContext.sectionName,
    majorSectionName: sectionContext.majorSectionName,
    designatedCompanyName,
    departmentHeadAgentId: sectionContext.departmentHeadAgentId,
    departmentHeadName: sectionContext.departmentHeadName,
  });
}

/**
 * Resolve recommended Work Plan approvers from the requestor's org-chart position
 * upward until Layer 2 (Layer 1 / top of the main org chart is excluded).
 */
export async function resolveWorkPlanOrgChartApprovalPath(
  requestorAgentId: string,
  opts?: { companyTeamId?: string | null },
): Promise<WorkPlanOrgChartApprovalPath> {
  const agentId = requestorAgentId.trim();
  if (!agentId) {
    return {
      requestorAgentId: "",
      requestorOrgLayer: null,
      seats: [emptyFallbackSeat()],
      usedFallback: true,
      defaults: emptyDefaults(),
      recommendedConfirmation: emptyConfirmer(),
    };
  }

  const [mergedSourceUserId, staff, orgNodes, sections] = await Promise.all([
    resolveMergedSourceUserIdForAgent(agentId),
    loadHrisAssignableStaff({}),
    prisma.orgChartNode.findMany({
      select: {
        id: true,
        parentId: true,
        mergedSourceUserId: true,
        personName: true,
      },
    }),
    prisma.orgChartSection.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        headNodeId: true,
        reportsToNodeId: true,
      },
    }),
  ]);

  const agentByMergedId = new Map(
    staff
      .filter((s) => s.mergedSourceUserId)
      .map((s) => [s.mergedSourceUserId, { agentId: s.agentId, name: s.name }] as const),
  );

  const parentByNodeId = orgChartReportingParentByNodeId(orgNodes, sections);
  const layerByNodeId = orgChartLayerById(orgNodes, parentByNodeId);
  const nodeByMergedId = new Map(orgNodes.map((n) => [n.mergedSourceUserId, n]));
  const nodeById = new Map(orgNodes.map((n) => [n.id, n]));

  const sectionHeadResult = await resolveSectionHeadAncestors({
    requestorAgentId: agentId,
    mergedSourceUserId,
    agentByMergedId,
    layerByNodeId,
    nodeById,
  });

  const defaults = await resolveWorkPlanRequestorDefaults(
    agentId,
    mergedSourceUserId,
    staff,
    opts?.companyTeamId,
    {
      sectionName: sectionHeadResult.sectionName,
      majorSectionName: sectionHeadResult.majorSectionName,
      departmentHeadAgentId: sectionHeadResult.departmentHeadAgentId,
      departmentHeadName: sectionHeadResult.departmentHeadName,
    },
  );

  let requestorOrgLayer: number | null = null;
  const peopleAncestors: TravelOrderOrgChartAncestor[] = [];

  if (mergedSourceUserId) {
    const start = nodeByMergedId.get(mergedSourceUserId);
    if (start) {
      requestorOrgLayer = layerByNodeId.get(start.id) ?? 1;
      let currentId = parentByNodeId.get(start.id) ?? null;
      const visiting = new Set<string>();
      while (currentId && !visiting.has(currentId)) {
        visiting.add(currentId);
        const current = nodeById.get(currentId);
        if (!current) break;
        const layer = layerByNodeId.get(current.id) ?? 1;
        const staffRow = agentByMergedId.get(current.mergedSourceUserId);
        const ancestorAgentId = staffRow?.agentId ?? null;
        // Include every ancestor up to Layer 2 (skip Layer 1).
        if (ancestorAgentId !== agentId && layer >= WORK_PLAN_APPROVAL_TOP_ORG_LAYER) {
          peopleAncestors.push({
            orgChartLayer: layer,
            agentId: ancestorAgentId,
            agentName: staffRow?.name ?? current.personName,
            mergedSourceUserId: current.mergedSourceUserId,
            alternateAgents: [],
          });
        }
        currentId = parentByNodeId.get(current.id) ?? null;
      }
    }
  }

  // Prefer section-head superiors (may share a people-chart layer with the requestor)
  // ahead of people-chart parents so sub-dept heads like Engelbert are not skipped.
  const mergedAncestors = mergeTravelOrderApprovalAncestors({
    sectionHeads: sectionHeadResult.sectionHeads.filter(
      (a) => a.orgChartLayer >= WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
    ),
    peopleAncestors,
  });

  // Audit Committee: Internal Audit head (Ailyn) then Audit Committee head (Juan Miguel).
  const orderedAncestors = ensureInternalAuditBeforeAuditCommittee({
    ancestors: mergedAncestors,
    requestorAgentId: agentId,
    sections,
    nodeById,
    agentByMergedId,
    layerByNodeId,
  });

  const seats =
    sectionHeadResult.sectionHeads.length > 0
      ? buildTravelOrderRecommendedPathFromChain(orderedAncestors)
      : buildTravelOrderRecommendedPath({
          requestorOrgLayer,
          ancestors: orderedAncestors,
          topOrgLayer: WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
        });

  let designations = new Map<string, string>();
  try {
    designations = await resolveDepartmentDesignationsByMergedIds(
      seats
        .map((seat) => seat.mergedSourceUserId)
        .filter((id): id is string => Boolean(id?.trim())),
    );
  } catch {
    designations = new Map();
  }
  const labeledSeats = seats.map((seat) => ({
    ...seat,
    label: "Approved by",
    hint:
      (seat.mergedSourceUserId
        ? designations.get(seat.mergedSourceUserId)
        : null) ?? "",
  }));

  const recommendedConfirmation = confirmerFromDefaults(
    defaults,
    sectionHeadResult.confirmerSectionName,
  );

  if (labeledSeats.length === 0) {
    return {
      requestorAgentId: agentId,
      requestorOrgLayer,
      seats: [emptyFallbackSeat()],
      usedFallback: true,
      defaults,
      recommendedConfirmation,
    };
  }

  const usedFallback =
    labeledSeats.some((s) => !s.agentId) || !recommendedConfirmation.agentId;
  return {
    requestorAgentId: agentId,
    requestorOrgLayer,
    seats: labeledSeats,
    usedFallback,
    defaults,
    recommendedConfirmation,
  };
}
