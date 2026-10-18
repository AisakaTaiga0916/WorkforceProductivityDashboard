/** Job Order ↔ Task Board Project linking helpers. */

import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  formatJobOrderTitle,
  parseJobOrderDescription,
  type JobOrderFields,
} from "@/modules/requests/job-order";
import {
  getLinkedJobOrderFromSubKpis,
  isProjectTask,
  setLinkedJobOrderOnSubKpis,
} from "@/modules/tasks/kpi-subkpis";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { logActivity } from "@/modules/requests/ticket-actions";

export type LinkedJobOrderProjectSummary = {
  id: string;
  title: string;
  mainTask: string | null;
  itProjectName: string | null;
};

export type JobOrderProjectPrefill = {
  ticketId: string;
  ticketNumber: string;
  title: string;
  teamId: string | null;
  teamName: string | null;
  alreadyLinkedProjectId: string | null;
  fields: JobOrderFields | null;
  suggestedProjectName: string;
  suggestedTargetDate: string;
  suggestedDescription: string;
};

function isLinkableProjectRow(row: {
  title: string;
  subKpis: unknown;
}): boolean {
  return isItProjectImplementationPillar(row.title) || isProjectTask(row.subKpis);
}

export function projectDisplayName(row: {
  title: string;
  mainTask?: string | null;
  itProjectName?: string | null;
}): string {
  const name =
    (row.itProjectName ?? "").trim() ||
    (row.mainTask ?? "").trim() ||
    row.title.trim();
  return name || "Untitled project";
}

/** Read linked project id via raw SQL so the app works before Prisma client regen. */
export async function getTicketLinkedKpiMaintenanceId(
  ticketId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ linked_kpi_maintenance_id: string | null }>>`
    SELECT linked_kpi_maintenance_id FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  return rows[0]?.linked_kpi_maintenance_id?.trim() || null;
}

export async function setTicketLinkedKpiMaintenanceId(
  ticketId: string,
  kpiMaintenanceId: string | null,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE tickets
    SET linked_kpi_maintenance_id = ${kpiMaintenanceId},
        updated_at = NOW()
    WHERE id = ${ticketId}
  `;
}

export async function loadLinkedJobOrderProject(
  linkedKpiMaintenanceId: string | null | undefined,
): Promise<LinkedJobOrderProjectSummary | null> {
  const id = linkedKpiMaintenanceId?.trim();
  if (!id) return null;
  const row = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, title: true, mainTask: true, itProjectName: true },
  });
  return row;
}

export async function buildJobOrderProjectPrefill(
  ticketId: string,
): Promise<JobOrderProjectPrefill | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      description: true,
      requestType: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  });
  if (!ticket || ticket.requestType !== "JOB_ORDER") return null;
  const linkedId = await getTicketLinkedKpiMaintenanceId(ticket.id);
  const fields = parseJobOrderDescription(ticket.description);
  const suggestedProjectName =
    fields != null
      ? formatJobOrderTitle(fields)
      : ticket.title.trim() || `Job Order ${ticket.ticketNumber}`;
  const suggestedTargetDate = fields?.targetDate?.trim() ?? "";
  const suggestedDescription = [
    `Linked Job Order: ${ticket.ticketNumber}`,
    fields?.natureOfConcern?.length
      ? `Nature of concern: ${fields.natureOfConcern.join(", ")}`
      : null,
    fields?.building ? `Building: ${fields.building}` : null,
    fields?.startDate ? `Start date: ${fields.startDate}` : null,
    fields?.targetDate ? `Target date: ${fields.targetDate}` : null,
    fields?.expectedDuration ? `Expected duration: ${fields.expectedDuration}` : null,
    fields?.notes ? `Notes: ${fields.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    teamId: ticket.teamId,
    teamName: ticket.team?.name ?? null,
    alreadyLinkedProjectId: linkedId,
    fields,
    suggestedProjectName,
    suggestedTargetDate,
    suggestedDescription,
  };
}

/**
 * Link a Job Order ticket to a Task Board project.
 * Idempotent when already linked to the same project; rejects if linked to another.
 */
export async function linkJobOrderToProject(opts: {
  ticketId: string;
  kpiMaintenanceId: string;
  actor: "AGENT" | "SYSTEM";
}): Promise<
  | { ok: true; project: LinkedJobOrderProjectSummary }
  | { ok: false; error: string; status: number }
> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: {
      id: true,
      ticketNumber: true,
      requestType: true,
      teamId: true,
    },
  });
  if (!ticket) return { ok: false, error: "Request not found.", status: 404 };
  if (ticket.requestType !== "JOB_ORDER") {
    return { ok: false, error: "Only Job Order requests can be linked to a project.", status: 400 };
  }

  const projectId = opts.kpiMaintenanceId.trim();
  if (!projectId) return { ok: false, error: "Select a project.", status: 400 };

  const existingLinkId = await getTicketLinkedKpiMaintenanceId(ticket.id);
  if (existingLinkId && existingLinkId === projectId) {
    const existing = await loadLinkedJobOrderProject(projectId);
    if (existing) return { ok: true, project: existing };
  }
  if (existingLinkId && existingLinkId !== projectId) {
    return {
      ok: false,
      error: "This Job Order is already linked to a project. Unlink it first to choose another.",
      status: 409,
    };
  }

  const project = await prisma.kpiMaintenance.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      mainTask: true,
      itProjectName: true,
      subKpis: true,
      scopedCompanyTeamId: true,
      assignedAgent: { select: { teamId: true } },
    },
  });
  if (!project) return { ok: false, error: "Project not found.", status: 404 };
  if (!isLinkableProjectRow(project)) {
    return { ok: false, error: "Selected item is not a Task Board project.", status: 400 };
  }

  const projectCompany =
    project.scopedCompanyTeamId?.trim() || project.assignedAgent?.teamId?.trim() || null;
  if (ticket.teamId && projectCompany && ticket.teamId !== projectCompany) {
    return {
      ok: false,
      error: "That project belongs to a different company than this Job Order.",
      status: 400,
    };
  }

  const nextSubKpisLinked = setLinkedJobOrderOnSubKpis(project.subKpis, {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
  });

  let nextSubKpis = nextSubKpisLinked;
  // Link-existing: seed / enrich Timeline Tracker (phase envelope + JO target) for non-IT projects.
  if (!isItProjectImplementationPillar(project.title)) {
    const { seedJoLinkedProjectTimeline } = await import("@/modules/tasks/it-project-subkpis");
    const fields = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { description: true },
    });
    const joFields = fields?.description ? parseJobOrderDescription(fields.description) : null;
    const targetDueDate = joFields?.targetDate?.trim() || null;
    nextSubKpis = seedJoLinkedProjectTimeline(nextSubKpis, { targetDueDate });
  }

  await setTicketLinkedKpiMaintenanceId(ticket.id, project.id);
  await prisma.kpiMaintenance.update({
    where: { id: project.id },
    data: { subKpis: nextSubKpis },
  });

  await logActivity(
    ticket.id,
    opts.actor,
    "Linked to project",
    `Linked to Task Board project “${projectDisplayName(project)}”.`,
  );

  const { fulfillPendingJobOrderProjectRequest } = await import(
    "@/modules/requests/job-order-project-request-server"
  );
  await fulfillPendingJobOrderProjectRequest({
    ticketId: ticket.id,
    actor: opts.actor,
    projectDisplayName: projectDisplayName(project),
  });

  return {
    ok: true,
    project: {
      id: project.id,
      title: project.title,
      mainTask: project.mainTask,
      itProjectName: project.itProjectName,
    },
  };
}

export async function unlinkJobOrderFromProject(opts: {
  ticketId: string;
  actor: "AGENT" | "SYSTEM";
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: {
      id: true,
      requestType: true,
    },
  });
  if (!ticket) return { ok: false, error: "Request not found.", status: 404 };
  if (ticket.requestType !== "JOB_ORDER") {
    return { ok: false, error: "Only Job Order requests can unlink a project.", status: 400 };
  }

  const linkedId = await getTicketLinkedKpiMaintenanceId(ticket.id);
  if (!linkedId) {
    return { ok: true };
  }

  const project = await prisma.kpiMaintenance.findUnique({
    where: { id: linkedId },
    select: { id: true, title: true, mainTask: true, itProjectName: true, subKpis: true },
  });

  await setTicketLinkedKpiMaintenanceId(ticket.id, null);

  if (project) {
    const existingLink = getLinkedJobOrderFromSubKpis(project.subKpis);
    if (!existingLink || existingLink.ticketId === ticket.id) {
      await prisma.kpiMaintenance.update({
        where: { id: project.id },
        data: { subKpis: setLinkedJobOrderOnSubKpis(project.subKpis, null) },
      });
    }
  }

  await logActivity(
    ticket.id,
    opts.actor,
    "Unlinked from project",
    project
      ? `Removed link to Task Board project “${projectDisplayName(project)}”.`
      : "Removed project link.",
  );

  return { ok: true };
}

/** After creating a project from a JO, attach the bidirectional link. */
export async function attachCreatedProjectToJobOrder(opts: {
  ticketId: string;
  kpiMaintenanceId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const result = await linkJobOrderToProject({
    ticketId: opts.ticketId,
    kpiMaintenanceId: opts.kpiMaintenanceId,
    actor: "SYSTEM",
  });
  if (!result.ok) return result;
  return { ok: true };
}

/** Load Job Orders linked to the given project ids (raw SQL for pre-generate compatibility). */
export async function loadJobOrdersLinkedToProjects(
  projectIds: string[],
): Promise<Array<{ id: string; ticketNumber: string; title: string; linkedKpiMaintenanceId: string }>> {
  if (projectIds.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      ticket_number: string;
      title: string;
      linked_kpi_maintenance_id: string;
    }>
  >`
    SELECT id, ticket_number, title, linked_kpi_maintenance_id
    FROM tickets
    WHERE request_type = 'JOB_ORDER'
      AND linked_kpi_maintenance_id IN (${Prisma.join(projectIds)})
  `;
  return rows.map((r) => ({
    id: r.id,
    ticketNumber: r.ticket_number,
    title: r.title,
    linkedKpiMaintenanceId: r.linked_kpi_maintenance_id,
  }));
}
