import { isElevatedUserRole } from "@/lib/auth";
import {
  resolveMergedSourceUserIdForAgent,
  resolveMergedSourceUserIdForSessionEmail,
} from "@/lib/approval-position-resolver";
import {
  resolveDeepestOrgChartSectionIdForMergedUser,
} from "@/lib/org-chart-section-roster";
import { isViewerOrgChartHeadForSection } from "@/lib/org-chart-section-scope";
import { prisma } from "@/lib/prisma";
import {
  collectAllSubKpiItems,
  collectChecklistProgressItems,
  normalizeSubKpis,
  subKpiAssignedAgentId,
} from "@/lib/kpi-subkpis";
import { isItProjectEnvelope, itProjectAllItems, parseItProjectSubKpis } from "@/lib/it-project-subkpis";
import {
  COMPLETION_VERIFICATION,
  isCompletionEffectivelyVerified,
  isPendingCompletionVerification,
  isSubKpiPendingVerification,
  type CompletionVerificationFields,
} from "@/lib/task-completion-verification";

export type CompletionVerifierContext = {
  operatorAgentId: string | null;
  operatorEmail: string | null;
  operatorName: string | null;
  role: string;
};

/**
 * Resolve the assignee's deepest org-chart section (department / sub-department).
 */
export async function resolveAssigneeOrgChartSectionId(
  assignedAgentId: string | null | undefined,
): Promise<string | null> {
  const agentId = assignedAgentId?.trim() || null;
  if (!agentId) return null;
  const mergedId = await resolveMergedSourceUserIdForAgent(agentId);
  if (!mergedId) return null;
  return resolveDeepestOrgChartSectionIdForMergedUser(mergedId);
}

/**
 * True when the operator is the org-chart head of the assignee's department
 * (or an ancestor department that contains it).
 */
export async function isOrgChartHeadForAssignee(opts: {
  operatorEmail: string | null | undefined;
  assignedAgentId: string | null | undefined;
}): Promise<boolean> {
  const sectionId = await resolveAssigneeOrgChartSectionId(opts.assignedAgentId);
  if (!sectionId) return false;
  return isViewerOrgChartHeadForSection(opts.operatorEmail, sectionId);
}

function checklistItemsForVerification(subKpis: unknown, taskTitle?: string) {
  if (isItProjectEnvelope(subKpis)) {
    return itProjectAllItems(parseItProjectSubKpis(subKpis));
  }
  const progress = collectChecklistProgressItems(subKpis, taskTitle);
  if (progress.length > 0) return progress;
  return collectAllSubKpiItems(normalizeSubKpis(subKpis));
}

export function pendingSubKpiItemsForVerification(
  row: {
    subKpis: unknown;
    title?: string | null;
    mainTask?: string | null;
  } & CompletionVerificationFields,
) {
  const parentVerified = isCompletionEffectivelyVerified(row);
  const label = (row.mainTask?.trim() || row.title || "").trim() || undefined;
  return checklistItemsForVerification(row.subKpis, label).filter((item) =>
    isSubKpiPendingVerification(item, { parentCardEffectivelyVerified: parentVerified }),
  );
}

/**
 * Who may verify task completion: org-chart department head for the main assignee
 * or for any pending sub-task assignee. Designated verifier + SuperAdmin / HighAdmin override.
 */
export async function canVerifyTaskCompletion(
  row: {
    assignedAgentId: string | null;
    verifierAgentId?: string | null;
    subKpis?: unknown;
    title?: string | null;
    mainTask?: string | null;
  } & Pick<CompletionVerificationFields, "completionVerificationStatus" | "lastFullCompletionAt">,
  ctx: CompletionVerifierContext,
  opts?: { subKpiId?: string | null },
): Promise<boolean> {
  const pendingSubs =
    row.subKpis != null
      ? pendingSubKpiItemsForVerification({
          subKpis: row.subKpis,
          title: row.title,
          mainTask: row.mainTask,
          completionVerificationStatus: row.completionVerificationStatus,
          lastFullCompletionAt: row.lastFullCompletionAt,
        })
      : [];
  const cardPending = isPendingCompletionVerification(row);
  if (!cardPending && pendingSubs.length === 0) return false;

  // Break-glass for platform elevated roles only (not every Admin).
  if (isElevatedUserRole(ctx.role)) return true;

  const email = ctx.operatorEmail?.trim() || null;
  if (!email) return false;

  // Optional designated verifier still allowed when explicitly set on the task.
  const designated = row.verifierAgentId?.trim() || null;
  const opId = ctx.operatorAgentId?.trim() || null;
  if (designated && opId && designated === opId) return true;

  if (opts?.subKpiId) {
    const target = pendingSubs.find((it) => it.id === opts.subKpiId);
    if (target) {
      const subAssignee = subKpiAssignedAgentId(target) ?? row.assignedAgentId;
      return isOrgChartHeadForAssignee({ operatorEmail: email, assignedAgentId: subAssignee });
    }
    // Card-level approve when no matching pending sub-task (main-task-only).
    if (!cardPending || pendingSubs.length > 0) return false;
  }

  if (
    await isOrgChartHeadForAssignee({
      operatorEmail: email,
      assignedAgentId: row.assignedAgentId,
    })
  ) {
    return true;
  }

  for (const item of pendingSubs) {
    const subAssignee = subKpiAssignedAgentId(item) ?? row.assignedAgentId;
    if (await isOrgChartHeadForAssignee({ operatorEmail: email, assignedAgentId: subAssignee })) {
      return true;
    }
  }

  return false;
}

/**
 * Sections the signed-in user heads (for batching pending-approval queries).
 */
export async function resolveSectionIdsHeadedByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  const mergedId = await resolveMergedSourceUserIdForSessionEmail(email);
  if (!mergedId) return [];
  const headed = await prisma.orgChartSection.findMany({
    where: { headNode: { mergedSourceUserId: mergedId } },
    select: { id: true },
  });
  return headed.map((h) => h.id);
}

/**
 * Pending verification KPI ids an org-chart head should see in For My Approval /
 * notifications. Includes cards with pending sub-tasks under the head's department.
 */
export async function listPendingVerificationKpiIdsForOrgChartHead(opts: {
  email: string | null | undefined;
  operatorAgentId?: string | null;
  role?: string;
  take?: number;
}): Promise<string[]> {
  const { isTaskCompletionVerificationEnabled } = await import(
    "@/lib/task-verification-settings-db"
  );
  if (!(await isTaskCompletionVerificationEnabled())) return [];

  const email = opts.email?.trim();
  if (!email && !isElevatedUserRole(opts.role ?? "")) return [];

  const take = Math.min(Math.max(opts.take ?? 120, 1), 300);
  const pendingCards = await prisma.kpiMaintenance.findMany({
    where: { completionVerificationStatus: COMPLETION_VERIFICATION.PENDING },
    select: {
      id: true,
      title: true,
      mainTask: true,
      assignedAgentId: true,
      verifierAgentId: true,
      pendingVerificationAt: true,
      completionVerificationStatus: true,
      lastFullCompletionAt: true,
      subKpis: true,
    },
    orderBy: { pendingVerificationAt: "desc" },
    take,
  });

  // Also pick up incomplete cards whose sub-tasks are done but never gated (legacy).
  const recentCandidates = await prisma.kpiMaintenance.findMany({
    where: {
      OR: [
        { completionVerificationStatus: null },
        { completionVerificationStatus: { not: COMPLETION_VERIFICATION.PENDING } },
      ],
      lastFullCompletionAt: null,
    },
    select: {
      id: true,
      title: true,
      mainTask: true,
      assignedAgentId: true,
      verifierAgentId: true,
      pendingVerificationAt: true,
      completionVerificationStatus: true,
      lastFullCompletionAt: true,
      subKpis: true,
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(take * 2, 400),
  });

  const byId = new Map<string, (typeof pendingCards)[number]>();
  for (const row of pendingCards) byId.set(row.id, row);
  for (const row of recentCandidates) {
    if (byId.has(row.id)) continue;
    if (pendingSubKpiItemsForVerification(row).length === 0) continue;
    byId.set(row.id, row);
  }

  const ctx: CompletionVerifierContext = {
    operatorAgentId: opts.operatorAgentId ?? null,
    operatorEmail: email || null,
    operatorName: null,
    role: opts.role ?? "Personnel",
  };

  const allowed: string[] = [];
  for (const row of byId.values()) {
    if (await canVerifyTaskCompletion(row, ctx)) {
      allowed.push(row.id);
    }
  }
  return allowed.slice(0, take);
}
