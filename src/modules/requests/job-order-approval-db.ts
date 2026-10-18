import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { findSessionAgentId } from "@/lib/session-agent";
import {
  defaultJobOrderApprovalMeta,
  isJobOrderAwaitingExecutionAssignee,
  parseJobOrderApprovalMeta,
  stampJobOrderCreatorAsPreparedBy,
  type JobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval";

export async function loadJobOrderApprovalMeta(
  ticketId: string,
): Promise<JobOrderApprovalMeta | null> {
  const rows = await prisma.$queryRaw<Array<{ job_order_approval_meta: unknown }>>`
    SELECT job_order_approval_meta FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  const raw = rows[0]?.job_order_approval_meta;
  if (raw == null) return null;
  return parseJobOrderApprovalMeta(raw);
}

export async function saveJobOrderApprovalMeta(
  ticketId: string,
  meta: JobOrderApprovalMeta,
): Promise<void> {
  const json = JSON.stringify(meta);
  await prisma.$executeRaw`
    UPDATE tickets
    SET job_order_approval_meta = ${json}::jsonb
    WHERE id = ${ticketId}
  `;
}

export async function initJobOrderApprovalMetaIfNeeded(
  ticketId: string,
): Promise<JobOrderApprovalMeta> {
  const existing = await loadJobOrderApprovalMeta(ticketId);
  if (existing) return existing;
  const meta = defaultJobOrderApprovalMeta();
  await saveJobOrderApprovalMeta(ticketId, meta);
  return meta;
}

/** Resolve or create an agent row for the person who submitted the Job Order. */
export async function resolveJobOrderCreatorAgentId(opts: {
  email?: string | null;
  name?: string | null;
  teamId?: string | null;
}): Promise<string | null> {
  const email = (opts.email ?? "").trim().toLowerCase();
  const name = (opts.name ?? "").trim() || email;
  if (!email && !name) return null;

  const existing = await findSessionAgentId({ email, name });
  if (existing?.id) return existing.id;

  if (!email || !opts.teamId) return null;
  await ensureAgentRowForPortalStaff({ email, name }, opts.teamId);
  const created = await findSessionAgentId({ email, name });
  return created?.id ?? null;
}

/** After ticket create (or lazy backfill): set Prepared By to the creator (intake only). */
export async function stampJobOrderCreatorOnCreate(opts: {
  ticketId: string;
  email?: string | null;
  name?: string | null;
  teamId?: string | null;
}): Promise<JobOrderApprovalMeta> {
  const meta = await initJobOrderApprovalMetaIfNeeded(opts.ticketId);
  if (meta.preparedByAgentId) {
    return meta;
  }
  const creatorAgentId = await resolveJobOrderCreatorAgentId({
    email: opts.email,
    name: opts.name,
    teamId: opts.teamId,
  });
  if (!creatorAgentId) return meta;
  const stamped = stampJobOrderCreatorAsPreparedBy(meta, creatorAgentId);
  await saveJobOrderApprovalMeta(opts.ticketId, stamped);
  return stamped;
}

export async function loadJobOrderApprovalMetaMap(
  ticketIds: string[],
): Promise<Map<string, JobOrderApprovalMeta>> {
  const map = new Map<string, JobOrderApprovalMeta>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; job_order_approval_meta: unknown }>
  >`
    SELECT id, job_order_approval_meta
    FROM tickets
    WHERE id IN (${Prisma.join(ticketIds)})
      AND job_order_approval_meta IS NOT NULL
  `;
  for (const row of rows) {
    const parsed = parseJobOrderApprovalMeta(row.job_order_approval_meta);
    if (parsed) map.set(row.id, parsed);
  }
  return map;
}

/** Clear stale procedural assignee after approval — ticket awaits execution assignment. */
export async function reconcileJobOrderAwaitingExecutionAssignee(
  ticketId: string,
): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      assignedAgentId: true,
      status: true,
      requestType: true,
    },
  });
  if (!ticket || ticket.requestType !== "JOB_ORDER") return false;

  const meta = await loadJobOrderApprovalMeta(ticketId);
  if (!isJobOrderAwaitingExecutionAssignee(meta)) return false;

  const needsAssigneeClear = Boolean(ticket.assignedAgentId);
  const needsStatusFix = ticket.status === "FOR_CONFIRMATION";
  if (!needsAssigneeClear && !needsStatusFix) return false;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      ...(needsAssigneeClear ? { assignedAgent: { disconnect: true } } : {}),
      status: "IN_PROGRESS",
      resolvedAt: null,
    },
  });
  return true;
}

export async function reconcileJobOrdersAwaitingExecutionAssignee(
  ticketIds: string[],
): Promise<void> {
  const unique = [...new Set(ticketIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(unique.map((id) => reconcileJobOrderAwaitingExecutionAssignee(id)));
}
