import type { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { resolveStaffCompanyIds } from "@/modules/platform/scope/staff-company-scope";
import { listActiveCompanies } from "@/modules/platform/companies/company-directory";
import { isProjectStatusValue, type ProjectStatusValue } from "@/modules/projects/project-status";

export type ProjectViewer = {
  role: string;
  isGlobal: boolean;
  operatorAgentId: string | null;
  companyIds: string[];
};

export async function resolveProjectViewer(session: {
  user: { role: string; email?: string | null; name?: string | null };
}): Promise<ProjectViewer> {
  const role = session.user.role;
  const isGlobal = role === "SuperAdmin" || role === "HighAdmin";
  const [ops, companyIds] = await Promise.all([
    resolveOpsPermissions(session),
    isGlobal ? Promise.resolve([] as string[]) : resolveStaffCompanyIds(session.user.email),
  ]);
  return {
    role,
    isGlobal,
    operatorAgentId: ops.operator?.id ?? null,
    companyIds,
  };
}

/** Company membership, project lead, or phase/item assignment. Globals see everything. */
export function projectWhereForViewer(viewer: ProjectViewer): Prisma.ProjectWhereInput {
  if (viewer.isGlobal) return {};
  const ors: Prisma.ProjectWhereInput[] = [];
  if (viewer.companyIds.length > 0) {
    ors.push({ scopedCompanyTeamId: { in: viewer.companyIds } });
  }
  if (viewer.operatorAgentId) {
    ors.push({ leadAgentId: viewer.operatorAgentId });
    ors.push({ phases: { some: { assignedAgentId: viewer.operatorAgentId } } });
    ors.push({ phases: { some: { items: { some: { assignedAgentId: viewer.operatorAgentId } } } } });
  }
  return ors.length > 0 ? { OR: ors } : { id: "__none__" };
}

export type ProjectItemDto = {
  id: string;
  title: string;
  status: ProjectStatusValue;
  priority: string | null;
  dueDate: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
};

export type ProjectPhaseDto = {
  id: string;
  name: string;
  sortOrder: number;
  dueDate: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  items: ProjectItemDto[];
};

export type ProjectDto = {
  id: string;
  title: string;
  status: ProjectStatusValue;
  dueDate: string | null;
  scopedCompanyTeamId: string | null;
  companyName: string | null;
  leadAgentId: string | null;
  leadAgentName: string | null;
  originJobOrderTicketId: string | null;
  activePhaseId: string | null;
  createdAt: string;
  phases: ProjectPhaseDto[];
};

const PROJECT_INCLUDE = {
  leadAgent: { select: { name: true } },
  phases: {
    orderBy: { sortOrder: "asc" },
    include: {
      assignedAgent: { select: { name: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        include: { assignedAgent: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

function toYmd(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function mapProjectRow(row: ProjectRow, companyNames: Map<string, string>): ProjectDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status as ProjectStatusValue,
    dueDate: toYmd(row.dueDate),
    scopedCompanyTeamId: row.scopedCompanyTeamId,
    companyName: row.scopedCompanyTeamId
      ? (companyNames.get(row.scopedCompanyTeamId) ?? null)
      : null,
    leadAgentId: row.leadAgentId,
    leadAgentName: row.leadAgent?.name ?? null,
    originJobOrderTicketId: row.originJobOrderTicketId,
    activePhaseId: row.activePhaseId,
    createdAt: row.createdAt.toISOString(),
    phases: row.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      sortOrder: phase.sortOrder,
      dueDate: toYmd(phase.dueDate),
      assignedAgentId: phase.assignedAgentId,
      assignedAgentName: phase.assignedAgent?.name ?? null,
      items: phase.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status as ProjectStatusValue,
        priority: item.priority ?? null,
        dueDate: toYmd(item.dueDate),
        assignedAgentId: item.assignedAgentId,
        assignedAgentName: item.assignedAgent?.name ?? null,
      })),
    })),
  };
}

async function loadCompanyNames(): Promise<Map<string, string>> {
  const companies = await listActiveCompanies();
  return new Map(companies.map((company) => [company.id, company.name]));
}

export async function listProjectsForViewer(viewer: ProjectViewer): Promise<ProjectDto[]> {
  const [rows, companyNames] = await Promise.all([
    prisma.project.findMany({
      where: projectWhereForViewer(viewer),
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: PROJECT_INCLUDE,
    }),
    loadCompanyNames(),
  ]);
  return rows.map((row) => mapProjectRow(row, companyNames));
}

export async function getProjectDtoForViewer(
  viewer: ProjectViewer,
  projectId: string,
): Promise<ProjectDto | null> {
  const [row, companyNames] = await Promise.all([
    prisma.project.findFirst({
      where: { AND: [projectWhereForViewer(viewer), { id: projectId }] },
      include: PROJECT_INCLUDE,
    }),
    loadCompanyNames(),
  ]);
  return row ? mapProjectRow(row, companyNames) : null;
}

export type CreateProjectInput = {
  title: string;
  scopedCompanyTeamId: string | null;
  dueDate: Date | null;
  firstPhaseName: string;
  originJobOrderTicketId: string | null;
};

export async function createProject(
  session: { user: { role: string; email?: string | null; name?: string | null } },
  viewer: ProjectViewer,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const createdBy = session.user.email?.trim() || session.user.name?.trim() || session.user.role;
  const project = await prisma.project.create({
    data: {
      title: input.title,
      status: "PENDING",
      dueDate: input.dueDate,
      scopedCompanyTeamId: input.scopedCompanyTeamId,
      originJobOrderTicketId: input.originJobOrderTicketId,
      createdBy,
      createdByRole: session.user.role,
      phases: {
        create: {
          name: input.firstPhaseName,
          sortOrder: 0,
        },
      },
    },
    include: { phases: { select: { id: true } } },
  });
  const activePhaseId = project.phases[0]?.id ?? null;
  if (activePhaseId) {
    await prisma.project.update({ where: { id: project.id }, data: { activePhaseId } });
  }
  const dto = await getProjectDtoForViewer(viewer, project.id);
  if (!dto) throw new Error("Project created but not readable by viewer");
  return dto;
}

/** Company picker options the viewer may create projects for. */
export function companyOptionsForViewer(
  viewer: ProjectViewer,
  companies: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  return viewer.isGlobal ? companies : companies.filter((c) => viewer.companyIds.includes(c.id));
}

/**
 * Validates the requested company for a create; defaults to the viewer's first
 * company so Personnel-created projects stay visible to their company.
 */
export async function resolveCreateCompanyId(
  viewer: ProjectViewer,
  requested: unknown,
): Promise<{ ok: true; companyId: string } | { ok: false; error: string }> {
  const companies = await listActiveCompanies();
  const requestedId = typeof requested === "string" && requested.trim() ? requested.trim() : null;
  if (requestedId) {
    if (!companies.some((c) => c.id === requestedId)) return { ok: false, error: "Unknown company" };
    if (!viewer.isGlobal && !viewer.companyIds.includes(requestedId)) {
      return { ok: false, error: "Company is outside your scope" };
    }
    return { ok: true, companyId: requestedId };
  }
  const fallback = viewer.companyIds[0] ?? null;
  if (fallback && companies.some((c) => c.id === fallback)) {
    return { ok: true, companyId: fallback };
  }
  return { ok: false, error: "Choose a company for this project" };
}

export type ActionResult = { status: number; body: unknown };

const ERROR_BAD_REQUEST = (error: string): ActionResult => ({ status: 400, body: { error } });
const ERROR_NOT_FOUND: ActionResult = { status: 404, body: { error: "Project not found" } };

export function parseYmdDate(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { ok: false };
  }
  return { ok: true, value: date };
}

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

/**
 * Apply one board/detail mutation. Callers must already hold `projects.update`;
 * scope is enforced here via `projectWhereForViewer`.
 */
export async function applyProjectAction(
  viewer: ProjectViewer,
  projectId: string,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const action = body.action;
  const project = await prisma.project.findFirst({
    where: { AND: [projectWhereForViewer(viewer), { id: projectId }] },
    select: { id: true, activePhaseId: true },
  });
  if (!project) return ERROR_NOT_FOUND;

  switch (action) {
    case "setStatus": {
      if (!isProjectStatusValue(body.status)) return ERROR_BAD_REQUEST("Invalid status");
      await prisma.project.update({ where: { id: projectId }, data: { status: body.status } });
      break;
    }
    case "setDueDate": {
      const parsed = parseYmdDate(body.dueDate);
      if (!parsed.ok) return ERROR_BAD_REQUEST("Invalid due date");
      await prisma.project.update({ where: { id: projectId }, data: { dueDate: parsed.value } });
      break;
    }
    case "addPhase": {
      const name = trimmedString(body.name, 120);
      if (!name) return ERROR_BAD_REQUEST("Phase name is required");
      const last = await prisma.projectPhase.aggregate({
        where: { projectId },
        _max: { sortOrder: true },
      });
      await prisma.projectPhase.create({
        data: { projectId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      break;
    }
    case "renamePhase": {
      const phaseId = trimmedString(body.phaseId, 64);
      const name = trimmedString(body.name, 120);
      if (!phaseId || !name) return ERROR_BAD_REQUEST("Phase name is required");
      const updated = await prisma.projectPhase.updateMany({
        where: { id: phaseId, projectId },
        data: { name },
      });
      if (updated.count === 0) return ERROR_BAD_REQUEST("Unknown phase");
      break;
    }
    case "removePhase": {
      const phaseId = trimmedString(body.phaseId, 64);
      if (!phaseId) return ERROR_BAD_REQUEST("Unknown phase");
      const phaseCount = await prisma.projectPhase.count({ where: { projectId } });
      if (phaseCount <= 1) return ERROR_BAD_REQUEST("A project needs at least one phase");
      const deleted = await prisma.projectPhase.deleteMany({ where: { id: phaseId, projectId } });
      if (deleted.count === 0) return ERROR_BAD_REQUEST("Unknown phase");
      if (project.activePhaseId === phaseId) {
        const nextPhase = await prisma.projectPhase.findFirst({
          where: { projectId },
          orderBy: { sortOrder: "asc" },
          select: { id: true },
        });
        await prisma.project.update({
          where: { id: projectId },
          data: { activePhaseId: nextPhase?.id ?? null },
        });
      }
      break;
    }
    case "setPhaseDueDate": {
      const phaseId = trimmedString(body.phaseId, 64);
      if (!phaseId) return ERROR_BAD_REQUEST("Unknown phase");
      const parsed = parseYmdDate(body.dueDate);
      if (!parsed.ok) return ERROR_BAD_REQUEST("Invalid due date");
      const updated = await prisma.projectPhase.updateMany({
        where: { id: phaseId, projectId },
        data: { dueDate: parsed.value },
      });
      if (updated.count === 0) return ERROR_BAD_REQUEST("Unknown phase");
      break;
    }
    case "addItem": {
      const phaseId = trimmedString(body.phaseId, 64);
      const title = trimmedString(body.title, 200);
      if (!phaseId || !title) return ERROR_BAD_REQUEST("Item title is required");
      const phase = await prisma.projectPhase.findFirst({
        where: { id: phaseId, projectId },
        select: { id: true },
      });
      if (!phase) return ERROR_BAD_REQUEST("Unknown phase");
      const parsed = parseYmdDate(body.dueDate);
      if (!parsed.ok) return ERROR_BAD_REQUEST("Invalid due date");
      const last = await prisma.projectItem.aggregate({
        where: { phaseId },
        _max: { sortOrder: true },
      });
      await prisma.projectItem.create({
        data: {
          phaseId,
          title,
          dueDate: parsed.value,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
      break;
    }
    case "renameItem":
    case "setItemStatus":
    case "setItemDueDate":
    case "removeItem": {
      const itemId = trimmedString(body.itemId, 64);
      if (!itemId) return ERROR_BAD_REQUEST("Unknown item");
      const item = await prisma.projectItem.findFirst({
        where: { id: itemId, phase: { projectId } },
        select: { id: true },
      });
      if (!item) return ERROR_BAD_REQUEST("Unknown item");

      if (action === "removeItem") {
        await prisma.projectItem.delete({ where: { id: itemId } });
        break;
      }
      if (action === "renameItem") {
        const title = trimmedString(body.title, 200);
        if (!title) return ERROR_BAD_REQUEST("Item title is required");
        await prisma.projectItem.update({ where: { id: itemId }, data: { title } });
        break;
      }
      if (action === "setItemStatus") {
        if (!isProjectStatusValue(body.status)) return ERROR_BAD_REQUEST("Invalid status");
        await prisma.projectItem.update({ where: { id: itemId }, data: { status: body.status } });
        break;
      }
      const parsed = parseYmdDate(body.dueDate);
      if (!parsed.ok) return ERROR_BAD_REQUEST("Invalid due date");
      await prisma.projectItem.update({ where: { id: itemId }, data: { dueDate: parsed.value } });
      break;
    }
    default:
      return ERROR_BAD_REQUEST("Unknown action");
  }

  const updated = await getProjectDtoForViewer(viewer, projectId);
  return { status: 200, body: { project: updated } };
}
