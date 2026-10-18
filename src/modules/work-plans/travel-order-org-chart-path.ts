import {
  resolveDirectManagerAgentId,
  resolveMergedSourceUserIdForAgent,
} from "@/modules/hierarchy/approval-position-resolver";
import { loadHrisAssignableStaff } from "@/modules/hierarchy/hris-staff-roster";
import { isHrSectionName } from "@/modules/hierarchy/hr-section-name";
import {
  pickDeepestOrgChartSectionId,
  resolveOrgChartSectionContext,
  resolveOrgChartSectionIdsForMergedUser,
} from "@/modules/hierarchy/org-chart-section-roster";
import { prisma } from "@/modules/platform/db/prisma";
import {
  TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER,
  type TravelOrderOrgChartPathSeat,
} from "@/modules/work-plans/travel-order";

export type TravelOrderRecommendedConfirmer = {
  agentId: string | null;
  agentName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  hint: string | null;
};

export type TravelOrderOrgChartApprovalPath = {
  requestorAgentId: string;
  requestorOrgLayer: number | null;
  seats: TravelOrderOrgChartPathSeat[];
  /** True when one or more recommended seats could not be filled from the org chart. */
  usedFallback?: boolean;
  /** Immediate department head for To be Confirmed by. */
  recommendedConfirmation?: TravelOrderRecommendedConfirmer;
};

type SectionHeadPerson = {
  agentId: string;
  agentName: string;
  mergedSourceUserId: string;
  sectionId: string;
  sectionName: string;
};

type SectionRow = {
  id: string;
  name: string;
  parentId: string | null;
  headNodeId: string | null;
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

function emptySeat(
  sequenceLevel: number,
  label: string,
  hint: string,
): TravelOrderOrgChartPathSeat {
  return {
    sequenceLevel,
    orgChartLayer: Math.max(
      TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER,
      5 - sequenceLevel,
    ),
    label,
    hint,
    recommendedOptional: false,
    agentId: null,
    agentName: null,
    mergedSourceUserId: null,
    alternateAgents: [],
  };
}

function seatFromHead(
  sequenceLevel: number,
  label: string,
  hint: string,
  head: SectionHeadPerson | null,
): TravelOrderOrgChartPathSeat {
  if (!head) return emptySeat(sequenceLevel, label, hint);
  return {
    sequenceLevel,
    orgChartLayer: Math.max(
      TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER,
      5 - sequenceLevel,
    ),
    label,
    hint,
    recommendedOptional: false,
    agentId: head.agentId,
    agentName: head.agentName,
    mergedSourceUserId: head.mergedSourceUserId,
    alternateAgents: [],
  };
}

async function resolveHeadPersonForSection(
  section: Pick<SectionRow, "id" | "name" | "headNodeId">,
  opts: {
    requestorAgentId: string;
    agentByMergedId: Map<string, { agentId: string; name: string }>;
    /** When true, allow returning the requestor if they are the head (not used for seats). */
    allowRequestor?: boolean;
  },
): Promise<SectionHeadPerson | null> {
  if (!section.headNodeId) return null;
  const headNode = await prisma.orgChartNode.findUnique({
    where: { id: section.headNodeId },
    select: { mergedSourceUserId: true, personName: true },
  });
  if (!headNode?.mergedSourceUserId) return null;
  const staff = opts.agentByMergedId.get(headNode.mergedSourceUserId);
  const agentId = staff?.agentId ?? null;
  if (!agentId) return null;
  if (!opts.allowRequestor && agentId === opts.requestorAgentId) return null;
  return {
    agentId,
    agentName: staff?.name ?? headNode.personName,
    mergedSourceUserId: headNode.mergedSourceUserId,
    sectionId: section.id,
    sectionName: section.name,
  };
}

/**
 * Deepest org-chart section membership for the requestor, plus its major (root) department.
 */
async function resolveRequestorDepartmentContext(mergedSourceUserId: string): Promise<{
  immediateSection: SectionRow | null;
  majorSection: SectionRow | null;
} | null> {
  const sectionIds = await resolveOrgChartSectionIdsForMergedUser(mergedSourceUserId);
  if (sectionIds.length === 0) return null;

  const deepestId = await pickDeepestOrgChartSectionId(sectionIds);
  if (!deepestId) return null;

  const sections = await prisma.orgChartSection.findMany({
    where: { id: { in: sectionIds } },
    select: { id: true, name: true, parentId: true, headNodeId: true },
  });
  if (sections.length === 0) return null;

  const immediate = sections.find((s) => s.id === deepestId) ?? sections[0] ?? null;
  if (!immediate) return null;

  const context = await resolveOrgChartSectionContext(immediate.id);
  const major = context?.main
    ? {
        id: context.main.id,
        name: context.main.name,
        parentId: context.main.parentId,
        headNodeId: context.main.headNodeId,
      }
    : immediate.parentId
      ? null
      : immediate;

  return { immediateSection: immediate, majorSection: major };
}

/**
 * Walk up from the requestor's section until a head who is not the requestor is found.
 */
async function resolveImmediateHead(opts: {
  requestorAgentId: string;
  startSection: SectionRow | null;
  agentByMergedId: Map<string, { agentId: string; name: string }>;
  mergedSourceUserId: string | null;
}): Promise<SectionHeadPerson | null> {
  let current: SectionRow | null = opts.startSection;
  const visiting = new Set<string>();

  while (current && !visiting.has(current.id)) {
    visiting.add(current.id);
    const head = await resolveHeadPersonForSection(current, {
      requestorAgentId: opts.requestorAgentId,
      agentByMergedId: opts.agentByMergedId,
    });
    if (head) return head;
    if (!current.parentId) break;
    current = await prisma.orgChartSection.findUnique({
      where: { id: current.parentId },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
  }

  if (opts.mergedSourceUserId) {
    const managerAgentId = await resolveDirectManagerAgentId({
      mergedSourceUserId: opts.mergedSourceUserId,
    });
    if (managerAgentId && managerAgentId !== opts.requestorAgentId) {
      const manager = [...opts.agentByMergedId.values()].find(
        (row) => row.agentId === managerAgentId,
      );
      const merged =
        [...opts.agentByMergedId.entries()].find(([, row]) => row.agentId === managerAgentId)?.[0] ??
        "";
      return {
        agentId: managerAgentId,
        agentName: manager?.name ?? "Manager",
        mergedSourceUserId: merged,
        sectionId: opts.startSection?.id ?? "",
        sectionName: opts.startSection?.name ?? "Reporting line",
      };
    }
  }

  return null;
}

async function resolveHrTeamHead(opts: {
  requestorAgentId: string;
  agentByMergedId: Map<string, { agentId: string; name: string }>;
}): Promise<SectionHeadPerson | null> {
  const sections = await prisma.orgChartSection.findMany({
    select: { id: true, name: true, parentId: true, headNodeId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const hrSections = sections.filter((s) => isHrSectionName(s.name));
  // Prefer exact-ish "HR TEAM" / shortest match first.
  hrSections.sort((a, b) => a.name.length - b.name.length);

  for (const section of hrSections) {
    const head = await resolveHeadPersonForSection(section, {
      requestorAgentId: opts.requestorAgentId,
      agentByMergedId: opts.agentByMergedId,
    });
    if (head) return head;
  }
  return null;
}

/**
 * Cross-department travel-order recommendations:
 * Approved by: immediate head → HR team head → major department head
 * Confirmed by: immediate head
 *
 * Approvers may still be reassigned to any org-chart head in the UI.
 */
export async function resolveTravelOrderOrgChartApprovalPath(
  requestorAgentId: string,
): Promise<TravelOrderOrgChartApprovalPath> {
  const agentId = requestorAgentId.trim();
  if (!agentId) {
    return {
      requestorAgentId: "",
      requestorOrgLayer: null,
      seats: [],
      recommendedConfirmation: emptyConfirmer(),
    };
  }

  const [mergedSourceUserId, staff] = await Promise.all([
    resolveMergedSourceUserIdForAgent(agentId),
    loadHrisAssignableStaff({}),
  ]);

  const agentByMergedId = new Map(
    staff
      .filter((s) => s.mergedSourceUserId)
      .map((s) => [s.mergedSourceUserId, { agentId: s.agentId, name: s.name }] as const),
  );

  const dept =
    mergedSourceUserId != null
      ? await resolveRequestorDepartmentContext(mergedSourceUserId)
      : null;

  const immediateHead = await resolveImmediateHead({
    requestorAgentId: agentId,
    startSection: dept?.immediateSection ?? null,
    agentByMergedId,
    mergedSourceUserId,
  });

  const hrHead = await resolveHrTeamHead({
    requestorAgentId: agentId,
    agentByMergedId,
  });

  let majorHead: SectionHeadPerson | null = null;
  if (dept?.majorSection) {
    majorHead = await resolveHeadPersonForSection(dept.majorSection, {
      requestorAgentId: agentId,
      agentByMergedId,
    });
    // If major head is the requestor, leave empty (cannot self-approve).
  }

  // Deduplicate approval agents while keeping three labeled seats (cross-dept reassignment allowed).
  const usedAgentIds = new Set<string>();
  function takeUnique(head: SectionHeadPerson | null): SectionHeadPerson | null {
    if (!head?.agentId || usedAgentIds.has(head.agentId)) return null;
    usedAgentIds.add(head.agentId);
    return head;
  }

  const immediateForApproval = takeUnique(immediateHead);
  const hrForApproval = takeUnique(hrHead);
  const majorForApproval = takeUnique(majorHead);

  const immediateHint = immediateHead?.sectionName
    ? `Immediate head — ${immediateHead.sectionName}`
    : "Immediate head of your department";
  const hrHint = hrHead?.sectionName
    ? `HR team head — ${hrHead.sectionName}`
    : "Head of the HR team (org-chart department)";
  const majorHint = majorHead?.sectionName
    ? `Major department head — ${majorHead.sectionName}`
    : dept?.majorSection?.name
      ? `Major department head — ${dept.majorSection.name}`
      : "Head of your major department";

  const seats: TravelOrderOrgChartPathSeat[] = [
    seatFromHead(1, "Immediate head", immediateHint, immediateForApproval),
    seatFromHead(
      2,
      "HR team head",
      hrForApproval
        ? hrHint
        : hrHead
          ? `${hrHint} (already in an earlier seat — pick another head if needed)`
          : hrHint,
      hrForApproval,
    ),
    seatFromHead(
      3,
      "Major department head",
      majorForApproval
        ? majorHint
        : majorHead
          ? `${majorHint} (already in an earlier seat — pick another head if needed)`
          : majorHint,
      majorForApproval,
    ),
  ];

  const recommendedConfirmation: TravelOrderRecommendedConfirmer = immediateHead
    ? {
        agentId: immediateHead.agentId,
        agentName: immediateHead.agentName,
        sectionId: immediateHead.sectionId || null,
        sectionName: immediateHead.sectionName || null,
        hint: immediateHint,
      }
    : emptyConfirmer();

  const usedFallback = seats.some((s) => !s.agentId) || !recommendedConfirmation.agentId;

  return {
    requestorAgentId: agentId,
    requestorOrgLayer: null,
    seats,
    usedFallback,
    recommendedConfirmation,
  };
}
