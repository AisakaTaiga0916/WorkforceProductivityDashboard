/**
 * Section-scoped approval recommendations for ticket intake.
 * Recommendations are rooted in the requestor's section tree. When the requestor
 * belongs to a subsection, that subsection's head is suggested first for Noted By.
 * Approved By uses the next section head up the tree (parent section).
 */
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import {
  resolveAgentIdsForOrgChartSection,
  resolveCompanyTeamIdForOrgChartSection,
  resolveMergedSourceUserIdsForOrgChartSection,
  resolveOrgChartSectionContext,
} from "@/lib/org-chart-section-roster";
import {
  ACA_APPROVING_PATH_LABELS,
  ACA_RECOMMENDING_LABELS,
  acaRecommendedByUsesRequestorCompanyLock,
  type AcaApprovingPath,
  type AcaRecommendingLevel,
} from "@/lib/aca-authority-matrix";
import { resolveAcaAssigneesFromPositions } from "@/lib/approval-position-resolver";
import {
  FTR_STEP_POSITION_CODES,
  RFP_STEP_POSITION_CODES,
  RS_STEP_POSITION_CODES,
} from "@/lib/position-catalog";
import { prisma } from "@/lib/prisma";
import { loadAgentIdsForCompanyTeam, resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import type { RequestTypeId } from "@/lib/request-types";

import { isHrSectionName } from "@/lib/hr-section-name";

export type IntakeRecommendationSource =
  | "subsection_head"
  | "position"
  | "section_head"
  | "next_section_head"
  | "bookkeeper_both"
  | "bookkeeper_send_to"
  | "bookkeeper_company"
  | "company_position"
  | null;

export type IntakeApprovalRecommendationSeat = {
  key: string;
  label: string;
  agentId: string | null;
  agentName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  source: IntakeRecommendationSource;
  hint: string | null;
};

export type IntakeApprovalRecommendationGuide = {
  requestType: RequestTypeId;
  requestorSectionId: string | null;
  requestorSectionName: string | null;
  requestorMainSectionId: string | null;
  requestorMainSectionName: string | null;
  sendToSectionId: string | null;
  sendToSectionName: string | null;
  sendToMainSectionId: string | null;
  sendToMainSectionName: string | null;
  requestorCompanyTeamId: string | null;
  requestorCompanyName: string | null;
  requestingCompanyTeamId: string | null;
  requestingCompanyName: string | null;
  seats: IntakeApprovalRecommendationSeat[];
};

function isAssignmentActive(now: Date, effectiveFrom: Date | null, effectiveTo: Date | null): boolean {
  if (effectiveFrom && effectiveFrom.getTime() > now.getTime()) return false;
  if (effectiveTo && effectiveTo.getTime() < now.getTime()) return false;
  return true;
}

function sourceHint(
  source: IntakeRecommendationSource,
  sectionName: string | null,
  positionLabel: string,
  mainSectionName: string | null,
  extra?: {
    sendToSectionName?: string | null;
    requestorCompanyName?: string | null;
    requestingCompanyName?: string | null;
  },
): string | null {
  switch (source) {
    case "subsection_head":
      return sectionName ? `Sub-department head — ${sectionName}` : "Sub-department head";
    case "position":
      return mainSectionName
        ? `${positionLabel} in ${mainSectionName}`
        : sectionName
          ? `${positionLabel} in ${sectionName}`
          : positionLabel;
    case "section_head":
      return mainSectionName
        ? `Main section head — ${mainSectionName}`
        : sectionName
          ? `Section head — ${sectionName}`
          : "Section head";
    case "next_section_head":
      return sectionName
        ? `Next section head — ${sectionName}`
        : "Next section head";
    case "bookkeeper_both":
      if (extra?.sendToSectionName && (extra?.requestingCompanyName || extra?.requestorCompanyName)) {
        const companyName = extra.requestingCompanyName ?? extra.requestorCompanyName;
        return `Bookkeeper in ${extra.sendToSectionName} assigned to ${companyName}`;
      }
      return "Bookkeeper in send-to section matched to company";
    case "bookkeeper_send_to":
      return extra?.sendToSectionName
        ? `Bookkeeper in send-to section ${extra.sendToSectionName}`
        : "Bookkeeper in send-to section";
    case "bookkeeper_company":
      return extra?.requestorCompanyName
        ? `Bookkeeper for requestor company ${extra.requestorCompanyName}`
        : "Bookkeeper for requestor company";
    case "company_position":
      return "Company position assignment";
    default:
      return null;
  }
}

async function loadStaffMaps() {
  const staff = await loadHrisAssignableStaff({});
  const agentByMerged = new Map<string, { agentId: string; name: string }>();
  const nameByAgentId = new Map<string, string>();
  for (const row of staff) {
    if (!row.mergedSourceUserId || !row.agentId) continue;
    agentByMerged.set(row.mergedSourceUserId, { agentId: row.agentId, name: row.name });
    nameByAgentId.set(row.agentId, row.name);
  }
  return { agentByMerged, nameByAgentId };
}

async function resolveAgentFromMergedId(
  mergedSourceUserId: string,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<{ agentId: string; agentName: string } | null> {
  const row = maps.agentByMerged.get(mergedSourceUserId);
  if (!row) return null;
  return { agentId: row.agentId, agentName: row.name };
}

async function resolveHeadForSection(
  section: { id: string; name: string; headNodeId: string | null },
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<{ agentId: string; agentName: string; sectionId: string; sectionName: string } | null> {
  if (!section.headNodeId) return null;
  const head = await prisma.orgChartNode.findUnique({
    where: { id: section.headNodeId },
    select: { mergedSourceUserId: true },
  });
  if (!head?.mergedSourceUserId) return null;
  const resolved = await resolveAgentFromMergedId(head.mergedSourceUserId, maps);
  if (!resolved) return null;
  return {
    ...resolved,
    sectionId: section.id,
    sectionName: section.name,
  };
}

async function resolvePositionHolderInSectionTree(opts: {
  sectionRootId: string;
  positionCode: string;
  companyTeamId?: string | null;
  /** When set, only consider holders whose merged id is in this set. */
  restrictToMergedIds?: Set<string>;
  maps: Awaited<ReturnType<typeof loadStaffMaps>>;
}): Promise<{ agentId: string; agentName: string } | null> {
  const position = await prisma.position.findFirst({
    where: { code: opts.positionCode, isActive: true },
    select: { id: true },
  });
  if (!position) return null;

  const mergedIds = await resolveMergedSourceUserIdsForOrgChartSection(opts.sectionRootId);
  if (mergedIds.length === 0) return null;
  const mergedSet = new Set(mergedIds);
  const now = new Date();

  const [assignments, primaryNodes] = await Promise.all([
    prisma.positionAssignment.findMany({
      where: {
        positionId: position.id,
        mergedSourceUserId: { in: mergedIds },
      },
      orderBy: [{ companyTeamId: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.orgChartNode.findMany({
      where: {
        mergedSourceUserId: { in: mergedIds },
        primaryPositionId: position.id,
      },
      select: { mergedSourceUserId: true },
    }),
  ]);

  const orderedMerged: string[] = [];
  for (const assignment of assignments) {
    if (!isAssignmentActive(now, assignment.effectiveFrom, assignment.effectiveTo)) continue;
    if (
      opts.companyTeamId &&
      assignment.companyTeamId &&
      assignment.companyTeamId !== opts.companyTeamId
    ) {
      continue;
    }
    if (!mergedSet.has(assignment.mergedSourceUserId)) continue;
    if (opts.restrictToMergedIds && !opts.restrictToMergedIds.has(assignment.mergedSourceUserId)) {
      continue;
    }
    if (!orderedMerged.includes(assignment.mergedSourceUserId)) {
      orderedMerged.push(assignment.mergedSourceUserId);
    }
  }
  for (const node of primaryNodes) {
    if (opts.restrictToMergedIds && !opts.restrictToMergedIds.has(node.mergedSourceUserId)) {
      continue;
    }
    if (!orderedMerged.includes(node.mergedSourceUserId)) {
      orderedMerged.push(node.mergedSourceUserId);
    }
  }

  for (const mergedId of orderedMerged) {
    const resolved = await resolveAgentFromMergedId(mergedId, opts.maps);
    if (resolved) return resolved;
  }
  return null;
}

/** Bookkeeper: user in send-to section whose company matches the effective company scope.
 * Excludes the send-to department head — that role is not a bookkeeper recommendation.
 */
async function resolveBookkeeperSeat(opts: {
  sendToSectionId: string | null;
  sendToSectionName: string | null;
  companyTeamId: string | null;
  companyName: string | null;
  requestorCompanyName?: string | null;
  requestingCompanyName?: string | null;
  maps: Awaited<ReturnType<typeof loadStaffMaps>>;
}): Promise<IntakeApprovalRecommendationSeat> {
  const key = "accountingAgentId";
  const label = "Prepared by Bookkeeper";
  const sendToSectionId = (opts.sendToSectionId ?? "").trim();
  const companyTeamId = (opts.companyTeamId ?? "").trim();
  const hintExtra = {
    sendToSectionName: opts.sendToSectionName,
    requestorCompanyName: opts.requestorCompanyName,
    requestingCompanyName: opts.requestingCompanyName,
  };

  if (!sendToSectionId) {
    return {
      ...emptySeat(key, label, null, opts.sendToSectionName),
      hint: "Select Send request to (department) to see a bookkeeper recommendation.",
    };
  }
  if (!companyTeamId) {
    return {
      ...emptySeat(key, label, sendToSectionId, opts.sendToSectionName),
      hint: opts.requestingCompanyName
        ? "Select requesting company to see a bookkeeper recommendation."
        : "Requestor company could not be determined.",
    };
  }

  const [sectionAgentIds, companyAgentIds, sendToContext] = await Promise.all([
    resolveAgentIdsForOrgChartSection(sendToSectionId),
    loadAgentIdsForCompanyTeam(companyTeamId),
    resolveOrgChartSectionContext(sendToSectionId),
  ]);

  const excludedHeadAgentIds = new Set<string>();
  if (sendToContext) {
    for (const section of [sendToContext.selected, sendToContext.main]) {
      if (!section) continue;
      const head = await resolveHeadForSection(section, opts.maps);
      if (head?.agentId) excludedHeadAgentIds.add(head.agentId);
    }
  }

  const companySet = new Set(companyAgentIds);
  const companyLabel = opts.companyName ?? "company";

  for (const agentId of sectionAgentIds) {
    if (!companySet.has(agentId)) continue;
    if (excludedHeadAgentIds.has(agentId)) continue;
    const agentName = opts.maps.nameByAgentId.get(agentId) ?? null;
    if (!agentName) continue;
    return {
      key,
      label,
      agentId,
      agentName,
      sectionId: sendToSectionId,
      sectionName: opts.sendToSectionName,
      source: "bookkeeper_both",
      hint: sourceHint("bookkeeper_both", null, label, null, hintExtra),
    };
  }

  const onlyHeadMatched =
    excludedHeadAgentIds.size > 0 &&
    sectionAgentIds.some((id) => companySet.has(id) && excludedHeadAgentIds.has(id));

  return {
    ...emptySeat(key, label, sendToSectionId, opts.sendToSectionName),
    hint: opts.sendToSectionName
      ? onlyHeadMatched
        ? `No bookkeeper in ${opts.sendToSectionName} for ${companyLabel} (department head is excluded).`
        : `No one in ${opts.sendToSectionName} assigned to ${companyLabel}.`
      : "No bookkeeper found in the send-to section for the selected company.",
  };
}

function emptySeat(
  key: string,
  label: string,
  sectionId: string | null,
  sectionName: string | null,
): IntakeApprovalRecommendationSeat {
  return {
    key,
    label,
    agentId: null,
    agentName: null,
    sectionId,
    sectionName,
    source: null,
    hint: null,
  };
}

/**
 * 1. Subsection head (when selected section is a subsection)
 * 2. Position holder under the main section tree
 * 3. Main section head
 */
async function resolveInSectionForPositionCode(opts: {
  sectionId: string;
  positionCode: string;
  companyTeamId?: string | null;
  maps: Awaited<ReturnType<typeof loadStaffMaps>>;
}): Promise<{
  agentId: string;
  agentName: string;
  sectionId: string;
  sectionName: string;
  mainSectionName: string;
  source: IntakeRecommendationSource;
} | null> {
  const sectionId = opts.sectionId.trim();
  if (!sectionId) return null;

  const context = await resolveOrgChartSectionContext(sectionId);
  if (!context?.main) return null;

  const { selected, main, isSubsection } = context;

  if (isSubsection && selected) {
    const subsectionHead = await resolveHeadForSection(selected, opts.maps);
    if (subsectionHead) {
      return {
        agentId: subsectionHead.agentId,
        agentName: subsectionHead.agentName,
        sectionId: subsectionHead.sectionId,
        sectionName: subsectionHead.sectionName,
        mainSectionName: main.name,
        source: "subsection_head",
      };
    }
  }

  const positionHolder = await resolvePositionHolderInSectionTree({
    sectionRootId: main.id,
    positionCode: opts.positionCode,
    companyTeamId: opts.companyTeamId,
    maps: opts.maps,
  });
  if (positionHolder) {
    return {
      ...positionHolder,
      sectionId: main.id,
      sectionName: main.name,
      mainSectionName: main.name,
      source: "position",
    };
  }

  const mainHead = await resolveHeadForSection(main, opts.maps);
  if (mainHead) {
    return {
      agentId: mainHead.agentId,
      agentName: mainHead.agentName,
      sectionId: mainHead.sectionId,
      sectionName: mainHead.sectionName,
      mainSectionName: main.name,
      source: "section_head",
    };
  }

  return null;
}

async function mainSectionHeadSeat(
  key: string,
  label: string,
  sectionId: string | null,
  sectionName: string | null,
  mainSectionName: string | null,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<IntakeApprovalRecommendationSeat> {
  if (!sectionId) {
    return emptySeat(key, label, null, sectionName);
  }
  const context = await resolveOrgChartSectionContext(sectionId);
  if (!context?.main) {
    return emptySeat(key, label, sectionId, sectionName);
  }
  const mainHead = await resolveHeadForSection(context.main, maps);
  if (!mainHead) {
    return emptySeat(key, label, context.main.id, context.main.name);
  }
  return {
    key,
    label,
    agentId: mainHead.agentId,
    agentName: mainHead.agentName,
    sectionId: mainHead.sectionId,
    sectionName: mainHead.sectionName,
    source: "section_head",
    hint: sourceHint(
      "section_head",
      mainHead.sectionName,
      label,
      context.main.name ?? mainSectionName,
    ),
  };
}

/**
 * Approved By for RFP: head of the next section up from the requestor
 * (immediate parent first, then further ancestors). Falls back to main section head.
 */
async function nextSectionHeadSeat(
  key: string,
  label: string,
  sectionId: string | null,
  sectionName: string | null,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<IntakeApprovalRecommendationSeat> {
  if (!sectionId) {
    return emptySeat(key, label, null, sectionName);
  }

  const selected = await prisma.orgChartSection.findUnique({
    where: { id: sectionId },
    select: { id: true, name: true, parentId: true, headNodeId: true },
  });
  if (!selected) {
    return emptySeat(key, label, sectionId, sectionName);
  }

  let currentParentId = selected.parentId;
  const seen = new Set<string>([selected.id]);

  while (currentParentId && !seen.has(currentParentId)) {
    seen.add(currentParentId);
    const parent = await prisma.orgChartSection.findUnique({
      where: { id: currentParentId },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
    if (!parent) break;

    const head = await resolveHeadForSection(parent, maps);
    if (head) {
      return {
        key,
        label,
        agentId: head.agentId,
        agentName: head.agentName,
        sectionId: head.sectionId,
        sectionName: head.sectionName,
        source: "next_section_head",
        hint: sourceHint("next_section_head", head.sectionName, label, null),
      };
    }
    currentParentId = parent.parentId;
  }

  // Requestor is already in a main section: use that section's head.
  if (!selected.parentId) {
    const ownHead = await resolveHeadForSection(selected, maps);
    if (ownHead) {
      return {
        key,
        label,
        agentId: ownHead.agentId,
        agentName: ownHead.agentName,
        sectionId: ownHead.sectionId,
        sectionName: ownHead.sectionName,
        source: "section_head",
        hint: sourceHint("section_head", ownHead.sectionName, label, selected.name),
      };
    }
  }

  return emptySeat(key, label, sectionId, sectionName ?? selected.name);
}

async function sectionSeat(
  key: string,
  label: string,
  positionCode: string,
  sectionId: string | null,
  sectionName: string | null,
  mainSectionName: string | null,
  companyTeamId: string | null,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<IntakeApprovalRecommendationSeat> {
  if (!sectionId) {
    return emptySeat(key, label, null, sectionName);
  }
  const resolved = await resolveInSectionForPositionCode({
    sectionId,
    positionCode,
    companyTeamId,
    maps,
  });
  if (!resolved) {
    return emptySeat(key, label, sectionId, sectionName);
  }
  return {
    key,
    label,
    agentId: resolved.agentId,
    agentName: resolved.agentName,
    sectionId: resolved.sectionId,
    sectionName: resolved.sectionName,
    source: resolved.source,
    hint: sourceHint(
      resolved.source,
      resolved.sectionName,
      label,
      resolved.mainSectionName ?? mainSectionName,
    ),
  };
}

/**
 * Head of the selected org-chart section. If a sub-department is selected,
 * uses that sub-department’s head; walks up parents only when no head is set.
 */
async function selectedSectionHeadSeat(
  key: string,
  label: string,
  sectionId: string | null,
  sectionName: string | null,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
  emptyHint?: string | null,
): Promise<IntakeApprovalRecommendationSeat> {
  if (!sectionId) {
    return {
      ...emptySeat(key, label, null, sectionName),
      hint: emptyHint ?? null,
    };
  }

  let currentId: string | null = sectionId;
  const seen = new Set<string>();

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const section: {
      id: string;
      name: string;
      parentId: string | null;
      headNodeId: string | null;
    } | null = await prisma.orgChartSection.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
    if (!section) break;

    const head = await resolveHeadForSection(section, maps);
    if (head) {
      const isSubsection = Boolean(section.parentId);
      return {
        key,
        label,
        agentId: head.agentId,
        agentName: head.agentName,
        sectionId: head.sectionId,
        sectionName: head.sectionName,
        source: isSubsection ? "subsection_head" : "section_head",
        hint: sourceHint(
          isSubsection ? "subsection_head" : "section_head",
          head.sectionName,
          label,
          null,
        ),
      };
    }
    currentId = section.parentId;
  }

  return {
    ...emptySeat(key, label, sectionId, sectionName),
    hint: sectionName
      ? `No department head found for ${sectionName}.`
      : "No department head found.",
  };
}

async function hrTeamHeadSeat(
  key: string,
  label: string,
  maps: Awaited<ReturnType<typeof loadStaffMaps>>,
): Promise<IntakeApprovalRecommendationSeat> {
  const sections = await prisma.orgChartSection.findMany({
    select: { id: true, name: true, parentId: true, headNodeId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const hrSections = sections.filter((s) => isHrSectionName(s.name));
  hrSections.sort((a, b) => a.name.length - b.name.length);

  for (const section of hrSections) {
    const head = await resolveHeadForSection(section, maps);
    if (head) {
      return {
        key,
        label,
        agentId: head.agentId,
        agentName: head.agentName,
        sectionId: head.sectionId,
        sectionName: head.sectionName,
        source: "section_head",
        hint: `HR team head — ${head.sectionName}`,
      };
    }
  }

  return {
    ...emptySeat(key, label, null, null),
    hint: "No HR team head found on the org chart.",
  };
}

async function loadSectionContextNames(sectionId: string | null | undefined): Promise<{
  sectionName: string | null;
  mainSectionId: string | null;
  mainSectionName: string | null;
}> {
  const context = await resolveOrgChartSectionContext(sectionId);
  if (!context) {
    return { sectionName: null, mainSectionId: null, mainSectionName: null };
  }
  return {
    sectionName: context.selected?.name ?? null,
    mainSectionId: context.main?.id ?? null,
    mainSectionName: context.main?.name ?? null,
  };
}

function seatFromResolvedAgent(opts: {
  key: string;
  label: string;
  agentId: string | null;
  maps: Awaited<ReturnType<typeof loadStaffMaps>>;
  sectionId?: string | null;
  sectionName?: string | null;
  source?: IntakeRecommendationSource;
  hint?: string | null;
}): IntakeApprovalRecommendationSeat {
  const agentId = (opts.agentId ?? "").trim() || null;
  const agentName = agentId ? opts.maps.nameByAgentId.get(agentId) ?? null : null;
  return {
    key: opts.key,
    label: opts.label,
    agentId: agentName ? agentId : null,
    agentName,
    sectionId: opts.sectionId ?? null,
    sectionName: opts.sectionName ?? null,
    source: agentName ? (opts.source ?? "company_position") : null,
    hint: agentName ? (opts.hint ?? sourceHint("company_position", null, opts.label, null)) : null,
  };
}

export async function resolveIntakeApprovalRecommendations(opts: {
  requestType: RequestTypeId;
  requestorSectionId?: string | null;
  sendToSectionId?: string | null;
  requestorEmail?: string | null;
  requestingCompanyTeamId?: string | null;
  requestorMergedSourceUserId?: string | null;
  skipNotedBy?: boolean;
  skipApprovedBy?: boolean;
  deferBookkeeper?: boolean;
  /** ACA matrix recommending level code (RA_1 … EXECOM). */
  acaRecommendingLevel?: string | null;
  /** ACA matrix approving path code (AP_1 … ALL_EXECOM). */
  acaApprovingPath?: string | null;
  acaApprovingSeatCount?: number | null;
}): Promise<IntakeApprovalRecommendationGuide> {
  const requestorSectionId = (opts.requestorSectionId ?? "").trim() || null;
  const sendToSectionId = (opts.sendToSectionId ?? "").trim() || null;
  const requestingCompanyTeamId = (opts.requestingCompanyTeamId ?? "").trim() || null;

  const requestorCompanyTeamId = await resolveStaffCompanyTeamId(opts.requestorEmail);
  const bookkeeperCompanyTeamId = requestingCompanyTeamId || requestorCompanyTeamId;

  const [requestorNames, sendToNames, maps, requestorCompanyRow, requestingCompanyRow] =
    await Promise.all([
      loadSectionContextNames(requestorSectionId),
      loadSectionContextNames(sendToSectionId),
      loadStaffMaps(),
      requestorCompanyTeamId
        ? prisma.team.findUnique({
            where: { id: requestorCompanyTeamId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      requestingCompanyTeamId
        ? prisma.team.findUnique({
            where: { id: requestingCompanyTeamId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
  const requestorCompanyName = requestorCompanyRow?.name ?? null;
  const requestingCompanyName = requestingCompanyRow?.name ?? null;
  const bookkeeperCompanyName = requestingCompanyName ?? requestorCompanyName;

  const requestorSectionCompanyTeamId = requestorNames.mainSectionId
    ? await resolveCompanyTeamIdForOrgChartSection(requestorNames.mainSectionId)
    : null;

  const seats: IntakeApprovalRecommendationSeat[] = [];

  if (opts.requestType === "REQUEST_FOR_PAYMENT") {
    if (!opts.skipNotedBy) {
      seats.push(
        await sectionSeat(
          "notedByAgentId",
          "Noted By",
          RFP_STEP_POSITION_CODES.NOTED_BY,
          requestorSectionId,
          requestorNames.sectionName,
          requestorNames.mainSectionName,
          requestorSectionCompanyTeamId,
          maps,
        ),
      );
    }
    if (!opts.skipApprovedBy) {
      seats.push(
        await nextSectionHeadSeat(
          "approvedByAgentId",
          "Approved By",
          requestorSectionId,
          requestorNames.sectionName,
          maps,
        ),
      );
    }
    if (!opts.deferBookkeeper) {
      seats.push(
        await resolveBookkeeperSeat({
          sendToSectionId,
          sendToSectionName: sendToNames.sectionName,
          companyTeamId: bookkeeperCompanyTeamId,
          companyName: bookkeeperCompanyName,
          requestorCompanyName,
          requestingCompanyName: requestingCompanyTeamId ? requestingCompanyName : null,
          maps,
        }),
      );
    }
  }

  if (opts.requestType === "FUND_TRANSFER_REQUEST") {
    seats.push(
      await sectionSeat(
        "recommendingApprovalAgentId",
        "Recommending Approval",
        FTR_STEP_POSITION_CODES.RECOMMENDING_APPROVAL!,
        requestorSectionId,
        requestorNames.sectionName,
        requestorNames.mainSectionName,
        requestorSectionCompanyTeamId,
        maps,
      ),
    );
    seats.push(
      await mainSectionHeadSeat(
        "approvedByAgentId",
        "Approved By",
        requestorSectionId,
        requestorNames.sectionName,
        requestorNames.mainSectionName,
        maps,
      ),
    );
  }

  if (opts.requestType === "JOB_ORDER") {
    // Requestor head → send-to (sub) department head → HR team head
    if (!opts.skipNotedBy) {
      seats.push(
        await selectedSectionHeadSeat(
          "notedByAgentId",
          "Noted By (Requestor head)",
          requestorSectionId,
          requestorNames.sectionName,
          maps,
          "Select your department to recommend the requestor’s department head.",
        ),
      );
    }
    if (!opts.skipApprovedBy) {
      seats.push(
        await selectedSectionHeadSeat(
          "approvedByAgentId",
          "Approved By (Send-to head)",
          sendToSectionId,
          sendToNames.sectionName,
          maps,
          "Select Send request to (department) to recommend that department’s head.",
        ),
      );
    }
    seats.push(await hrTeamHeadSeat("approvedBy2AgentId", "HR Approver", maps));
  }

  if (opts.requestType === "ITEM_REQUISITION_SLIP") {
    // Canvassed By is set from Assignment Board later — recommend Approved By only.
    seats.push(
      await sectionSeat(
        "approvedByAgentId",
        "Approved By",
        RS_STEP_POSITION_CODES.APPROVED_BY,
        requestorSectionId,
        requestorNames.sectionName,
        requestorNames.mainSectionName,
        requestorSectionCompanyTeamId ?? requestorCompanyTeamId,
        maps,
      ),
    );
  }

  if (opts.requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
    const recommendingLevel = (opts.acaRecommendingLevel ?? "").trim() as AcaRecommendingLevel;
    const approvingPath = (opts.acaApprovingPath ?? "").trim() as AcaApprovingPath;
    const seatCount = Math.max(0, Math.floor(Number(opts.acaApprovingSeatCount) || 0));
    const knownRecommending = recommendingLevel in ACA_RECOMMENDING_LABELS;
    const knownApproving = approvingPath in ACA_APPROVING_PATH_LABELS;

    if (knownRecommending && knownApproving && seatCount > 0) {
      const useRequestorCompanyLock = acaRecommendedByUsesRequestorCompanyLock(recommendingLevel);
      const resolved = await resolveAcaAssigneesFromPositions({
        recommendingLevel,
        approvingPath,
        approvingSeatCount: seatCount,
        companyTeamId: requestorCompanyTeamId,
        requestorMergedSourceUserId: opts.requestorMergedSourceUserId,
        useRequestorCompanyLock,
      });

      seats.push(
        seatFromResolvedAgent({
          key: "recommendedByAgentId",
          label: ACA_RECOMMENDING_LABELS[recommendingLevel] ?? "Recommended By",
          agentId: resolved.recommendedByAgentId,
          maps,
          hint: useRequestorCompanyLock
            ? "Position holder in your company (Recommended By)"
            : "Position holder for Recommended By",
        }),
      );
      seats.push(
        seatFromResolvedAgent({
          key: "financeManagerAgentId",
          label: "Finance Manager",
          agentId: resolved.financeManagerAgentId,
          maps,
          hint: "Finance position holder",
        }),
      );
      for (let i = 0; i < seatCount; i += 1) {
        const agentId = resolved.approvingAgentIds[i] ?? null;
        seats.push(
          seatFromResolvedAgent({
            key: `approvingAgentId${i}`,
            label:
              seatCount === 1
                ? (ACA_APPROVING_PATH_LABELS[approvingPath] ?? "Approving")
                : `${ACA_APPROVING_PATH_LABELS[approvingPath] ?? "Approving"} (${i + 1})`,
            agentId,
            maps,
            hint: "Approving path position holder",
          }),
        );
      }
    }
  }

  return {
    requestType: opts.requestType,
    requestorSectionId,
    requestorSectionName: requestorNames.sectionName,
    requestorMainSectionId: requestorNames.mainSectionId,
    requestorMainSectionName: requestorNames.mainSectionName,
    sendToSectionId,
    sendToSectionName: sendToNames.sectionName,
    sendToMainSectionId: sendToNames.mainSectionId,
    sendToMainSectionName: sendToNames.mainSectionName,
    requestorCompanyTeamId,
    requestorCompanyName,
    requestingCompanyTeamId,
    requestingCompanyName,
    seats,
  };
}
