/**
 * Work Plan approval recommendations: walk the requestor's org-chart parents
 * from the layer above them up to Layer 2 (Layer 1 is excluded).
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
  type TravelOrderOrgChartAncestor,
  type TravelOrderOrgChartPathSeat,
} from "@/lib/travel-order";
import {
  WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
  type WorkPlanRequestorDefaults,
} from "@/lib/work-plan";
import type { TravelOrderRecommendedConfirmer } from "@/lib/travel-order-org-chart-path";

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
): TravelOrderRecommendedConfirmer {
  const agentId = defaults.departmentHeadAgentId?.trim() || null;
  const sectionName = defaults.sectionName?.trim() || defaults.majorSectionName?.trim() || null;
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

async function resolveWorkPlanRequestorDefaults(
  requestorAgentId: string,
  mergedSourceUserId: string | null,
  staff: Array<{ agentId: string; name: string; mergedSourceUserId: string }>,
  designatedCompanyTeamId?: string | null,
): Promise<WorkPlanRequestorDefaults> {
  const staffRow = staff.find((s) => s.agentId === requestorAgentId) ?? null;
  const agentByMergedId = new Map(
    staff.filter((s) => s.mergedSourceUserId).map((s) => [s.mergedSourceUserId, s] as const),
  );

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

  const sectionIds = mergedSourceUserId
    ? await resolveOrgChartSectionIdsForMergedUser(mergedSourceUserId)
    : [];
  const deepestId = await pickDeepestOrgChartSectionId(sectionIds);
  const context = deepestId ? await resolveOrgChartSectionContext(deepestId) : null;
  const section = context?.selected ?? null;
  const major = context?.main ?? section;

  let departmentHeadAgentId: string | null = null;
  let departmentHeadName: string | null = null;
  let current = section;
  const visiting = new Set<string>();
  while (current && !visiting.has(current.id)) {
    visiting.add(current.id);
    if (current.headNodeId) {
      const headNode = await prisma.orgChartNode.findUnique({
        where: { id: current.headNodeId },
        select: { mergedSourceUserId: true, personName: true },
      });
      const merged = headNode?.mergedSourceUserId?.trim() || "";
      if (merged) {
        const headStaff = agentByMergedId.get(merged);
        if (headStaff?.agentId) {
          departmentHeadAgentId = headStaff.agentId;
          departmentHeadName = headStaff.name?.trim() || headNode?.personName?.trim() || null;
          break;
        }
      }
    }
    if (!current.parentId) break;
    current = await prisma.orgChartSection.findUnique({
      where: { id: current.parentId },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
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
    sectionName: section?.name?.trim() || null,
    majorSectionName: major?.name?.trim() || null,
    designatedCompanyName,
    departmentHeadAgentId,
    departmentHeadName,
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
      select: { headNodeId: true, reportsToNodeId: true },
    }),
  ]);

  const defaults = await resolveWorkPlanRequestorDefaults(
    agentId,
    mergedSourceUserId,
    staff,
    opts?.companyTeamId,
  );

  const agentByMergedId = new Map(
    staff
      .filter((s) => s.mergedSourceUserId)
      .map((s) => [s.mergedSourceUserId, { agentId: s.agentId, name: s.name }] as const),
  );

  const parentByNodeId = orgChartReportingParentByNodeId(orgNodes, sections);
  const layerByNodeId = orgChartLayerById(orgNodes, parentByNodeId);
  const nodeByMergedId = new Map(orgNodes.map((n) => [n.mergedSourceUserId, n]));
  const nodeById = new Map(orgNodes.map((n) => [n.id, n]));

  let requestorOrgLayer: number | null = null;
  const ancestors: TravelOrderOrgChartAncestor[] = [];

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
          ancestors.push({
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

  const seats = buildTravelOrderRecommendedPath({
    requestorOrgLayer,
    ancestors,
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
    recommendedOptional: false,
    label: "Approved by",
    hint:
      (seat.mergedSourceUserId
        ? designations.get(seat.mergedSourceUserId)
        : null) ?? "",
  }));

  const recommendedConfirmation = confirmerFromDefaults(defaults);

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
