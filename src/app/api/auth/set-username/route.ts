import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/modules/platform/auth";
import { findPortalByEmailOnly, findPortalByUsername } from "@/lib/portal-account";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { roleIdPatchForLegacyChange } from "@/modules/platform/rbac/rbac-role-sync";
import { prisma } from "@/modules/platform/db/prisma";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

const VALID_ORG_ROLES = ["Customer", "Personnel"] as const;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as {
    username?: string;
    companyId?: string;
    customerOrgRole?: string;
  };

  if (!body.username || typeof body.username !== "string") {
    return NextResponse.json({ error: "Username is required." }, { status: 400 });
  }

  const trimmed = body.username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return NextResponse.json(
      { error: "Username must be 3–32 characters and may only contain letters, numbers, periods, underscores, and hyphens." },
      { status: 400 },
    );
  }

  if (!body.companyId || typeof body.companyId !== "string") {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  const orgRole = body.customerOrgRole?.trim();
  if (!orgRole || !(VALID_ORG_ROLES as readonly string[]).includes(orgRole)) {
    return NextResponse.json({ error: "Organization role is required." }, { status: 400 });
  }

  const portal = await findPortalByEmailOnly(session.user.email);
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }

  if (portal.username) {
    return NextResponse.json({ error: "Username is already set." }, { status: 400 });
  }

  const existing = await findPortalByUsername(trimmed);
  if (existing && existing.id !== portal.id) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
  }

  const companyId = body.companyId.trim();

  const company = await prisma.team.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) {
    return NextResponse.json({ error: "Selected company does not exist." }, { status: 400 });
  }

  const isStaffRole = orgRole === "Personnel";

  try {
    await prisma.portalAccount.update({
      where: { id: portal.id },
      data: {
        username: trimmed.toLowerCase(),
        role: isStaffRole ? "Personnel" : "Customer",
        ...(await roleIdPatchForLegacyChange(portal.id, isStaffRole ? "Personnel" : "Customer")),
        headPrivileges: false,
        companyId: isStaffRole ? null : companyId,
        customerOrgRole: isStaffRole ? null : "Personnel",
        staffDesignatedCompanyId: isStaffRole ? companyId : null,
      },
    });

    if (isStaffRole) {
      try {
        await ensureAgentRowForPortalStaff(
          { email: portal.email, name: portal.name },
          companyId,
        );
      } catch (e) {
        console.error("ensureAgentRowForPortalStaff failed for Google sign-up user", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not set username." }, { status: 500 });
  }
}
