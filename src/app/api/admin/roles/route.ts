import type { Prisma } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { ensureAgentRowForPortalStaff, pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { rosterTeamNameFilter, sortByRosterOrder, COMPANY_ROSTER } from "@/lib/company-roster";
import { requireRole } from "@/lib/access";
import { createStaffPortalAccount, findPortalByEmailOnly } from "@/lib/portal-account";
import { normalizePersonnelAssignmentColor } from "@/lib/personnel-assignment-colors";
import {
  getPortalStaffAssignmentColor,
  loadPortalStaffAssignmentColorMap,
  setPortalStaffAssignmentColor,
} from "@/lib/portal-staff-assignment-color-sql";
import { prisma } from "@/lib/prisma";
import {
  isAdminEligibleStaffRole,
  isPlatformSuperAdminPortalRole,
  isStaffPortalRole,
  normalizePortalRole,
  PORTAL_ROLES,
} from "@/lib/staff-role";

const MANAGEABLE_ROLES = new Set<string>(PORTAL_ROLES);

export async function GET() {
  const { unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized) return unauthorized;

  const [portalRows, rosterTeams, agents, assignmentColorByPortalId] = await Promise.all([
    prisma.portalAccount.findMany({
      where: {
        // Portal Accounts registry (SuperAdmin): HRIS merge-linked ACTIVE rows only.
        // PostgreSQL-only / legacy duplicates are hidden; progress remapped onto HRIS agents.
        mergedSourceUserId: { not: null },
        accountStatus: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        email: true,
        name: true,
        role: true,
        headPrivileges: true,
        accountStatus: true,
        companyId: true,
        customerOrgRole: true,
        staffDesignatedCompanyId: true,
        company: { select: { id: true, name: true } },
        staffDesignatedCompany: { select: { id: true, name: true } },
        createdAt: true,
      },
    }),
    prisma.team.findMany({
      where: rosterTeamNameFilter(),
      select: { id: true, name: true },
    }),
    prisma.agent.findMany({
      include: { team: true },
      orderBy: { createdAt: "asc" },
    }),
    loadPortalStaffAssignmentColorMap(),
  ]);

  const accounts = portalRows.map((row) => {
    const staff = isStaffPortalRole(row.role);
    const canonical = staff ? pickCanonicalAgentForPortal(row, agents) : null;
    return {
      ...row,
      staffAssignmentColor: staff
        ? (assignmentColorByPortalId.get(row.id) ?? null)
        : null,
      agentId: canonical?.id ?? null,
      queueTeamId: canonical?.teamId ?? null,
      queueTeamName: canonical?.team?.name ?? null,
      onPersonnelRoster: Boolean(staff && canonical),
    };
  });

  return NextResponse.json({
    accounts,
    rosterCompanies: sortByRosterOrder(rosterTeams),
  });
}

const portalAccountPatchSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  headPrivileges: true,
  companyId: true,
  customerOrgRole: true,
  staffDesignatedCompanyId: true,
  company: { select: { id: true, name: true } },
  staffDesignatedCompany: { select: { id: true, name: true } },
  createdAt: true,
} satisfies Prisma.PortalAccountSelect;

export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const body = (await req.json()) as {
    id?: string;
    role?: string;
    headPrivileges?: boolean;
    companyId?: string | null;
    customerOrgRole?: string | null;
    staffDesignatedCompanyId?: string | null;
    staffAssignmentColor?: string | null;
  };
  const id = body.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const assignmentColorPatch = body.staffAssignmentColor !== undefined;

  const existing = await prisma.portalAccount.findUnique({
    where: { id },
    select: {
      role: true,
      headPrivileges: true,
      companyId: true,
      customerOrgRole: true,
      staffDesignatedCompanyId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  /** Company portal Admin: may only PATCH assignment color for own-SBU Admin/Personnel roster. */
  if (session.user.role === "Admin") {
    const otherField =
      body.role !== undefined ||
      body.headPrivileges !== undefined ||
      body.companyId !== undefined ||
      body.customerOrgRole !== undefined ||
      body.staffDesignatedCompanyId !== undefined;
    if (otherField || !assignmentColorPatch) {
      return NextResponse.json(
        { error: "You can only update assignment colors for staff on your company roster." },
        { status: 403 },
      );
    }
    if (!isStaffPortalRole(existing.role)) {
      return NextResponse.json(
        { error: "Assignment color applies only to Admin and Personnel portal accounts." },
        { status: 403 },
      );
    }
    const viewer = await findPortalByEmailOnly(session.user.email ?? "");
    const scopeId = viewer?.staffDesignatedCompanyId ?? null;
    if (!scopeId) {
      return NextResponse.json(
        { error: "Your account has no designated company queue." },
        { status: 403 },
      );
    }
    if (existing.staffDesignatedCompanyId !== scopeId) {
      return NextResponse.json(
        { error: "That account is not on your company roster." },
        { status: 403 },
      );
    }
    const raw = body.staffAssignmentColor;
    let assignmentColorNext: string | null;
    if (raw === null || raw === "") {
      assignmentColorNext = null;
    } else {
      const normalized = normalizePersonnelAssignmentColor(String(raw));
      if (!normalized) {
        return NextResponse.json(
          { error: "Invalid assignment color. Use a hex code like #FF5733." },
          { status: 400 },
        );
      }
      assignmentColorNext = normalized;
    }
    try {
      await setPortalStaffAssignmentColor(id, assignmentColorNext);
    } catch (e) {
      console.error("setPortalStaffAssignmentColor failed", e);
      return NextResponse.json({ error: "Could not save assignment color." }, { status: 500 });
    }
    const updatedBase = await prisma.portalAccount.findUnique({
      where: { id },
      select: portalAccountPatchSelect,
    });
    if (!updatedBase) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      account: { ...updatedBase, staffAssignmentColor: assignmentColorNext },
    });
  }

  const data: Prisma.PortalAccountUpdateInput = {};

  if (body.role !== undefined) {
    const role = body.role.trim();
    if (!MANAGEABLE_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (role === "SuperAdmin" && session.user.role !== "SuperAdmin") {
      return NextResponse.json(
        { error: "Only a SuperAdmin may assign the platform SuperAdmin portal role." },
        { status: 403 },
      );
    }
    if (role === "HighAdmin" && session.user.role !== "SuperAdmin") {
      return NextResponse.json(
        { error: "Only a SuperAdmin may assign the HighAdmin portal role." },
        { status: 403 },
      );
    }
    data.role = role;
    data.headPrivileges = false;
    if (role !== "Customer") {
      data.company = { disconnect: true };
      data.customerOrgRole = null;
    }
    // SuperAdmin has no company queue; HighAdmin may keep a designated company for approver scoping.
    if (role === "SuperAdmin") {
      data.staffDesignatedCompany = { disconnect: true };
    }
  }

  if (body.headPrivileges !== undefined) {
    const nextRoleRaw = (typeof data.role === "string" ? data.role : existing.role) as string;
    if (!isAdminEligibleStaffRole(nextRoleRaw)) {
      return NextResponse.json(
        { error: "Company coordination applies only to Admin staff accounts." },
        { status: 400 },
      );
    }
    data.headPrivileges = Boolean(body.headPrivileges);
  }

  const companyPatchRequested = body.companyId !== undefined || body.customerOrgRole !== undefined;
  if (companyPatchRequested) {
    const effectiveRoleRaw = (typeof data.role === "string" ? data.role : existing.role) as string;
    const effectiveRole = normalizePortalRole(effectiveRoleRaw) ?? effectiveRoleRaw;
    if (effectiveRole !== "Customer") {
      return NextResponse.json(
        { error: "Company and customer org role apply only to Customer portal accounts." },
        { status: 400 },
      );
    }

    if (body.companyId !== undefined) {
      if (body.companyId === null || body.companyId === "") {
        data.company = { disconnect: true };
        data.customerOrgRole = null;
      } else {
        const cid = String(body.companyId).trim();
        const team = await prisma.team.findUnique({ where: { id: cid }, select: { name: true } });
        if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
          return NextResponse.json({ error: "Invalid company queue." }, { status: 400 });
        }
        data.company = { connect: { id: cid } };
        const orgRaw =
          body.customerOrgRole !== undefined ? body.customerOrgRole : existing.customerOrgRole;
        const org = orgRaw === "Head" ? "Admin" : orgRaw;
        if (org !== "Admin" && org !== "Personnel") {
          return NextResponse.json(
            { error: "Customer org role must be Admin or Personnel when a company is set." },
            { status: 400 },
          );
        }
        data.customerOrgRole = org;
      }
    } else if (body.customerOrgRole !== undefined) {
      if (!existing.companyId) {
        return NextResponse.json(
          { error: "Set a company queue before updating customer org role." },
          { status: 400 },
        );
      }
      const orgRaw = body.customerOrgRole;
      const org = orgRaw === "Head" ? "Admin" : orgRaw;
      if (org !== null && org !== "Admin" && org !== "Personnel") {
        return NextResponse.json({ error: "Org role must be Admin or Personnel." }, { status: 400 });
      }
      data.customerOrgRole = org;
    }
  }

  const staffCompanyPatch = body.staffDesignatedCompanyId !== undefined;
  if (staffCompanyPatch) {
    const effectiveRoleRaw = (typeof data.role === "string" ? data.role : existing.role) as string;
    const effective = normalizePortalRole(effectiveRoleRaw);
    if (
      effective !== "Admin" &&
      effective !== "Personnel" &&
      effective !== "Customer" &&
      effective !== "HighAdmin" &&
      effective !== "SuperAdmin"
    ) {
      return NextResponse.json(
        {
          error:
            "Designated company applies only to HighAdmin, Admin, Personnel, or Customer portal accounts.",
        },
        { status: 400 },
      );
    }
    if (effective === "SuperAdmin") {
      return NextResponse.json(
        { error: "Platform SuperAdmin accounts do not use a designated company queue." },
        { status: 400 },
      );
    }
    if (body.staffDesignatedCompanyId === null || body.staffDesignatedCompanyId === "") {
      data.staffDesignatedCompany = { disconnect: true };
    } else {
      const tid = String(body.staffDesignatedCompanyId).trim();
      const team = await prisma.team.findUnique({ where: { id: tid }, select: { name: true } });
      if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
        return NextResponse.json({ error: "Invalid designated company." }, { status: 400 });
      }
      data.staffDesignatedCompany = { connect: { id: tid } };
    }
  }

  let assignmentColorNext: string | null | undefined;
  if (assignmentColorPatch) {
    const effectiveRoleRaw = (typeof data.role === "string" ? data.role : existing.role) as string;
    const raw = body.staffAssignmentColor;
    if (raw === null || raw === "") {
      assignmentColorNext = null;
    } else {
      if (!isStaffPortalRole(effectiveRoleRaw)) {
        return NextResponse.json(
          { error: "Assignment color applies only to Admin and Personnel portal accounts." },
          { status: 400 },
        );
      }
      const normalized = normalizePersonnelAssignmentColor(String(raw));
      if (!normalized) {
        return NextResponse.json(
          { error: "Invalid assignment color. Use a hex code like #FF5733." },
          { status: 400 },
        );
      }
      assignmentColorNext = normalized;
    }
  }

  if (Object.keys(data).length === 0 && !assignmentColorPatch) {
    return NextResponse.json(
      {
        error:
          "Provide role, headPrivileges, company, staff designated company, and/or staff assignment color fields.",
      },
      { status: 400 },
    );
  }

  let updatedBase: Prisma.PortalAccountGetPayload<{ select: typeof portalAccountPatchSelect }> | null = null;
  if (Object.keys(data).length > 0) {
    updatedBase = await prisma.portalAccount.update({
      where: { id },
      data,
      select: portalAccountPatchSelect,
    });
  } else {
    updatedBase = await prisma.portalAccount.findUnique({
      where: { id },
      select: portalAccountPatchSelect,
    });
  }

  if (!updatedBase) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  if (
    isPlatformSuperAdminPortalRole(existing.role) &&
    !isPlatformSuperAdminPortalRole(updatedBase.role)
  ) {
    try {
      await setPortalStaffAssignmentColor(id, null);
    } catch (e) {
      console.error("setPortalStaffAssignmentColor (demoted platform SuperAdmin) failed", e);
    }
  }

  if (assignmentColorPatch) {
    try {
      await setPortalStaffAssignmentColor(id, assignmentColorNext!);
    } catch (e) {
      console.error("setPortalStaffAssignmentColor failed", e);
      return NextResponse.json({ error: "Could not save assignment color." }, { status: 500 });
    }
  }

  let staffAssignmentColor = assignmentColorPatch
    ? assignmentColorNext!
    : await getPortalStaffAssignmentColor(id);

  if (isPlatformSuperAdminPortalRole(updatedBase.role)) {
    try {
      await setPortalStaffAssignmentColor(id, null);
    } catch (e) {
      console.error("setPortalStaffAssignmentColor (platform SuperAdmin) failed", e);
    }
    staffAssignmentColor = null;
  }

  const updated = { ...updatedBase, staffAssignmentColor };

  /**
   * Whenever the portal is staff and has a designated company, keep the Agent
   * roster in sync. We must not only run this when `staffDesignatedCompanyId`
   * is in the PATCH body — if the SuperAdmin sets the company first and later
   * changes role from Customer to Personnel/Admin, the roster would otherwise
   * never get the Agent row.
   */
  if (updated.staffDesignatedCompanyId && isStaffPortalRole(updated.role)) {
    try {
      await ensureAgentRowForPortalStaff(
        { email: updated.email, name: updated.name },
        updated.staffDesignatedCompanyId,
      );
    } catch (e) {
      console.error("ensureAgentRowForPortalStaff failed", e);
    }
  }

  return NextResponse.json({ ok: true, account: updated });
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validUsername(username: string) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

export async function POST(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized) return unauthorized;

  let body: {
    username?: string;
    email?: string;
    name?: string;
    password?: string;
    role?: string;
    staffDesignatedCompanyId?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username = body.username?.trim().toLowerCase() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const name = body.name?.trim() ?? "";
  const password = body.password ?? "";
  const roleRaw = body.role?.trim() ?? "";
  const teamId = body.staffDesignatedCompanyId?.trim() ?? "";

  if (name.length < 2) {
    return NextResponse.json({ error: "Please enter a display name." }, { status: 400 });
  }
  if (!validUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 3–32 characters (letters, numbers, . _ -)." },
      { status: 400 },
    );
  }
  if (!validEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length === 0) {
    return NextResponse.json({ error: "Enter a password." }, { status: 400 });
  }
  if (roleRaw !== "Admin" && roleRaw !== "Personnel") {
    return NextResponse.json({ error: "Role must be Admin or Personnel." }, { status: 400 });
  }
  if (!teamId) {
    return NextResponse.json(
      { error: "Choose a designated company queue so the user appears on the roster." },
      { status: 400 },
    );
  }

  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
    return NextResponse.json({ error: "Invalid designated company." }, { status: 400 });
  }

  const created = await createStaffPortalAccount({
    username,
    email,
    name,
    password,
    role: roleRaw as "Admin" | "Personnel",
    staffDesignatedCompanyId: teamId,
  });
  if (!created.ok) {
    if (created.code === "DUPLICATE") {
      return NextResponse.json({ error: "Username or email is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }

  const account = await prisma.portalAccount.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      headPrivileges: true,
      staffDesignatedCompanyId: true,
      company: { select: { id: true, name: true } },
      staffDesignatedCompany: { select: { id: true, name: true } },
      createdAt: true,
    },
  });
  if (!account?.staffDesignatedCompanyId) {
    return NextResponse.json({ ok: true, account });
  }
  try {
    await ensureAgentRowForPortalStaff(
      { email: account.email, name: account.name },
      account.staffDesignatedCompanyId,
    );
  } catch (e) {
    console.error("ensureAgentRowForPortalStaff failed after staff create", e);
  }

  return NextResponse.json({ ok: true, account });
}
