import { prisma } from "@/modules/platform/db/prisma";
import { loadHrisAssignableStaff } from "@/modules/hierarchy/hris-staff-roster";
import {
  FTR_STEP_POSITION_CODES,
  JO_STEP_POSITION_CODES,
  RFP_STEP_POSITION_CODES,
  RS_STEP_POSITION_CODES,
} from "@/modules/hierarchy/position-catalog";
import type { PaymentApprovalStep } from "@/modules/requests/request-for-payment-approval";
import type { ItemRequisitionApprovalStep } from "@/modules/requests/item-requisition-approval";
import type { FundTransferApprovalStep } from "@/modules/requests/fund-transfer-approval";
import type { JobOrderApprovalStep } from "@/modules/requests/job-order-approval";

function isAssignmentActive(now: Date, effectiveFrom: Date | null, effectiveTo: Date | null): boolean {
  if (effectiveFrom && effectiveFrom.getTime() > now.getTime()) return false;
  if (effectiveTo && effectiveTo.getTime() < now.getTime()) return false;
  return true;
}

async function agentIdForMergedUserId(
  mergedSourceUserId: string,
  companyTeamId?: string | null,
): Promise<string | null> {
  const staff = await loadHrisAssignableStaff({ companyTeamId: companyTeamId ?? null });
  const row = staff.find((person) => person.mergedSourceUserId === mergedSourceUserId);
  return row?.agentId ?? null;
}

async function findPositionByCode(code: string) {
  return prisma.position.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, level: true },
  });
}

async function listActiveAssignments(positionId: string, companyTeamId?: string | null) {
  const now = new Date();
  const rows = await prisma.positionAssignment.findMany({
    where: {
      positionId,
      OR: companyTeamId
        ? [{ companyTeamId }, { companyTeamId: null }]
        : [{ companyTeamId: null }],
    },
    orderBy: [{ companyTeamId: "desc" }, { updatedAt: "desc" }],
  });
  return rows.filter((row) => isAssignmentActive(now, row.effectiveFrom, row.effectiveTo));
}

/**
 * Resolve a single agent id for a position code.
 * Prefers company-scoped assignment, then global; falls back to org-chart manager walk.
 */
export async function resolveAgentIdForPositionCode(opts: {
  code: string;
  companyTeamId?: string | null;
  requestorMergedSourceUserId?: string | null;
}): Promise<string | null> {
  const position = await findPositionByCode(opts.code);
  if (!position) return null;

  const assignments = await listActiveAssignments(position.id, opts.companyTeamId ?? null);
  for (const assignment of assignments) {
    const agentId = await agentIdForMergedUserId(
      assignment.mergedSourceUserId,
      assignment.companyTeamId ?? opts.companyTeamId ?? null,
    );
    if (agentId) return agentId;
  }

  if (opts.requestorMergedSourceUserId) {
    const managerAgentId = await resolveDirectManagerAgentId({
      mergedSourceUserId: opts.requestorMergedSourceUserId,
      companyTeamId: opts.companyTeamId ?? null,
    });
    if (managerAgentId) return managerAgentId;
  }

  return null;
}

/** Resolve all agent ids holding a position (multi-seat paths like FOUR_EXECOMS). */
export async function resolveAgentIdsForPositionCode(opts: {
  code: string;
  companyTeamId?: string | null;
  limit?: number;
}): Promise<string[]> {
  const position = await findPositionByCode(opts.code);
  if (!position) return [];

  const assignments = await listActiveAssignments(position.id, opts.companyTeamId ?? null);
  const limit = Math.max(1, opts.limit ?? assignments.length);
  const agentIds: string[] = [];

  for (const assignment of assignments) {
    const agentId = await agentIdForMergedUserId(
      assignment.mergedSourceUserId,
      assignment.companyTeamId ?? opts.companyTeamId ?? null,
    );
    if (agentId && !agentIds.includes(agentId)) {
      agentIds.push(agentId);
    }
    if (agentIds.length >= limit) break;
  }

  return agentIds;
}

/** Direct manager from org chart parent node. */
export async function resolveDirectManagerAgentId(opts: {
  mergedSourceUserId: string;
  companyTeamId?: string | null;
}): Promise<string | null> {
  const node = await prisma.orgChartNode.findUnique({
    where: { mergedSourceUserId: opts.mergedSourceUserId },
    select: {
      parent: { select: { mergedSourceUserId: true } },
    },
  });
  const managerMergedId = node?.parent?.mergedSourceUserId;
  if (!managerMergedId) return null;
  return agentIdForMergedUserId(managerMergedId, opts.companyTeamId ?? null);
}

export async function resolveMergedSourceUserIdForAgent(agentId: string): Promise<string | null> {
  const staff = await loadHrisAssignableStaff({});
  return staff.find((row) => row.agentId === agentId)?.mergedSourceUserId ?? null;
}

export async function resolveMergedSourceUserIdForSessionEmail(
  email: string | null | undefined,
): Promise<string | null> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const portal = await prisma.portalAccount.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
    select: { mergedSourceUserId: true },
  });
  if (portal?.mergedSourceUserId != null) {
    return String(portal.mergedSourceUserId);
  }
  const staff = await loadHrisAssignableStaff({});
  return staff.find((row) => row.email.trim().toLowerCase() === normalized)?.mergedSourceUserId ?? null;
}

export type PositionResolutionContext = {
  companyTeamId?: string | null;
  requestorMergedSourceUserId?: string | null;
};

export async function resolveRfpAssigneesFromPositions(
  ctx: PositionResolutionContext,
): Promise<Partial<Record<PaymentApprovalStep, string>>> {
  const entries = await Promise.all(
    (Object.entries(RFP_STEP_POSITION_CODES) as Array<[PaymentApprovalStep, string]>).map(
      async ([step, code]) => {
        const agentId = await resolveAgentIdForPositionCode({
          code,
          companyTeamId: ctx.companyTeamId,
          requestorMergedSourceUserId: ctx.requestorMergedSourceUserId,
        });
        return [step, agentId] as const;
      },
    ),
  );
  const out: Partial<Record<PaymentApprovalStep, string>> = {};
  for (const [step, agentId] of entries) {
    if (agentId) out[step] = agentId;
  }
  return out;
}

export async function resolveRsAssigneesFromPositions(
  ctx: PositionResolutionContext,
): Promise<Partial<Record<ItemRequisitionApprovalStep, string>>> {
  // Canvassed By is driven by Assignment Board assignee — only resolve Approved By here.
  const approvedByAgentId = await resolveAgentIdForPositionCode({
    code: RS_STEP_POSITION_CODES.APPROVED_BY,
    companyTeamId: ctx.companyTeamId,
    requestorMergedSourceUserId: ctx.requestorMergedSourceUserId,
  });
  const out: Partial<Record<ItemRequisitionApprovalStep, string>> = {};
  if (approvedByAgentId) out.APPROVED_BY = approvedByAgentId;
  return out;
}

export async function resolveFtrAssigneesFromPositions(
  ctx: PositionResolutionContext,
): Promise<Partial<Record<FundTransferApprovalStep, string>>> {
  const entries = await Promise.all(
    (Object.entries(FTR_STEP_POSITION_CODES) as Array<[FundTransferApprovalStep, string]>).map(
      async ([step, code]) => {
        const agentId = await resolveAgentIdForPositionCode({
          code,
          companyTeamId: ctx.companyTeamId,
          requestorMergedSourceUserId: ctx.requestorMergedSourceUserId,
        });
        return [step, agentId] as const;
      },
    ),
  );
  const out: Partial<Record<FundTransferApprovalStep, string>> = {};
  for (const [step, agentId] of entries) {
    if (agentId) out[step] = agentId;
  }
  return out;
}

export async function resolveJoAssigneesFromPositions(
  ctx: PositionResolutionContext,
): Promise<Partial<Record<JobOrderApprovalStep, string>>> {
  const entries = await Promise.all(
    (Object.entries(JO_STEP_POSITION_CODES) as Array<[JobOrderApprovalStep, string]>).map(
      async ([step, code]) => {
        const agentId = await resolveAgentIdForPositionCode({
          code,
          companyTeamId: ctx.companyTeamId,
          requestorMergedSourceUserId: ctx.requestorMergedSourceUserId,
        });
        return [step, agentId] as const;
      },
    ),
  );
  const out: Partial<Record<JobOrderApprovalStep, string>> = {};
  for (const [step, agentId] of entries) {
    if (agentId) out[step] = agentId;
  }
  return out;
}

