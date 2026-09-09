/** Server-only Job Order worker / assistance queries (Prisma). */

import { Prisma } from "@prisma/client/primary";
import { ACTIVE_REQUEST_STATUSES } from "@/lib/active-request-statuses";
import { prisma } from "@/lib/prisma";

/**
 * Linked Task Board project ids where the agent is a JO co-worker (Field Assignment-style visibility).
 */
export async function kpiIdsWhereAgentIsJobOrderWorker(
  agentId: string | null | undefined,
): Promise<Set<string>> {
  const id = agentId?.trim();
  if (!id) return new Set();
  const rows = await prisma.$queryRaw<Array<{ linked_kpi_maintenance_id: string | null }>>`
    SELECT linked_kpi_maintenance_id
    FROM tickets
    WHERE request_type = 'JOB_ORDER'
      AND linked_kpi_maintenance_id IS NOT NULL
      AND job_order_approval_meta->'workerAgentIds' @> ${JSON.stringify([id])}::jsonb
  `;
  return new Set(
    rows
      .map((row) => row.linked_kpi_maintenance_id?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

async function expandAgentIdsForSameEmail(agentId: string): Promise<string[]> {
  const id = agentId.trim();
  if (!id) return [];
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { email: true },
  });
  const email = agent?.email?.trim();
  if (!email) return [id];
  const siblings = await prisma.agent.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return [...new Set([id, ...siblings.map((s) => s.id)])];
}

/**
 * Job Order ticket ids where the agent is on Seek Assistance (assignee/co-workers),
 * the staged/pending execution assignee, or an execution co-worker.
 */
export async function loadJobOrderTicketIdsVisibleToAgent(
  agentId: string | null | undefined,
): Promise<string[]> {
  const seed = agentId?.trim();
  if (!seed) return [];
  const agentIds = await expandAgentIdsForSameEmail(seed);
  if (agentIds.length === 0) return [];

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM tickets
    WHERE request_type = 'JOB_ORDER'
      AND job_order_approval_meta IS NOT NULL
      AND status::text IN (${Prisma.join([...ACTIVE_REQUEST_STATUSES])})
      AND (
        job_order_approval_meta->'assistanceTeam'->>'assigneeAgentId' IN (${Prisma.join(agentIds)})
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            COALESCE(job_order_approval_meta->'assistanceTeam'->'workerAgentIds', '[]'::jsonb)
          ) AS w(agent_id)
          WHERE w.agent_id IN (${Prisma.join(agentIds)})
        )
        OR job_order_approval_meta->>'pendingExecutionAssigneeAgentId' IN (${Prisma.join(agentIds)})
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            COALESCE(job_order_approval_meta->'workerAgentIds', '[]'::jsonb)
          ) AS w(agent_id)
          WHERE w.agent_id IN (${Prisma.join(agentIds)})
        )
      )
  `;
  return rows.map((r) => r.id);
}
