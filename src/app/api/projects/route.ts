import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { listActiveCompanies } from "@/modules/platform/companies/company-directory";
import {
  hasPermission,
  permissionDenied,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import {
  companyOptionsForViewer,
  createProject,
  listProjectsForViewer,
  parseYmdDate,
  resolveCreateCompanyId,
  resolveProjectViewer,
} from "@/modules/projects/project-service";

const BOARD_ROLES = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"];

export async function GET() {
  const session = await requireSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!BOARD_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await permissionDenied(session, "projects.read");
  if (denied) return denied;

  const viewer = await resolveProjectViewer(session);
  const [projects, companies, canCreate] = await Promise.all([
    listProjectsForViewer(viewer),
    listActiveCompanies(),
    hasPermission(permissionSubjectFromSession(session), "projects.create"),
  ]);

  return NextResponse.json({
    projects,
    companies: companyOptionsForViewer(viewer, companies),
    canCreate,
  });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!BOARD_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await permissionDenied(session, "projects.create");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "Project title is required" }, { status: 400 });
  }

  const parsedDueDate = parseYmdDate(body.dueDate);
  if (!parsedDueDate.ok) {
    return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
  }

  const firstPhaseName =
    typeof body.firstPhaseName === "string" && body.firstPhaseName.trim()
      ? body.firstPhaseName.trim().slice(0, 120)
      : "Phase 1";

  const originJobOrderTicketId =
    typeof body.originJobOrderTicketId === "string" && body.originJobOrderTicketId.trim()
      ? body.originJobOrderTicketId.trim()
      : null;

  const viewer = await resolveProjectViewer(session);
  const company = await resolveCreateCompanyId(viewer, body.scopedCompanyTeamId);
  if (!company.ok) return NextResponse.json({ error: company.error }, { status: 400 });

  const project = await createProject(session, viewer, {
    title,
    scopedCompanyTeamId: company.companyId,
    dueDate: parsedDueDate.value,
    firstPhaseName,
    originJobOrderTicketId,
  });

  return NextResponse.json({ project }, { status: 201 });
}
