import { NextResponse } from "next/server";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { isPersonnelGuardPortalRole, isStaffPortalRole } from "@/lib/staff-role";

/**
 * PATCH /api/admin/personnel/company
 * SuperAdmin: set the company of an HRIS user's account (main DB only; the merged
 * DB is never written — it is an import source).
 * Body: { mergedSourceUserId: string, teamId: string | null }
 */
export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "users.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    mergedSourceUserId?: string;
    teamId?: string | null;
  };

  const mergedIdRaw = body.mergedSourceUserId?.trim() ?? "";
  if (!/^\d+$/.test(mergedIdRaw)) {
    return NextResponse.json({ error: "mergedSourceUserId is required." }, { status: 400 });
  }
  const mergedSourceUserId = BigInt(mergedIdRaw);

  const hrisUser = await prismaPrimary.hrisUser.findFirst({
    where: {
      sourceUserId: mergedSourceUserId,
      sourceDatabase: { in: resolveHrisSourceTags() },
      isActive: true,
    },
    select: { email: true },
  });
  if (!hrisUser) {
    return NextResponse.json(
      { error: "HRIS user not found. Re-run the merged-dump import if they were added recently." },
      { status: 404 },
    );
  }

  let companyName: string | null = null;
  let teamId: string | null = null;

  if (body.teamId != null && String(body.teamId).trim() !== "") {
    teamId = String(body.teamId).trim();
    const team = await prismaPrimary.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    if (!team) {
      return NextResponse.json({ error: "Company queue not found." }, { status: 404 });
    }
    companyName = team.name;
  }

  // Keep linked portal profile + agent queue aligned when present.
  // Prefer HRIS-linked portal; fall back to email (merge may lag the link).
  const emailNeedle = hrisUser.email?.trim().toLowerCase() || null;
  let portal =
    (await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId, accountStatus: { not: "LEGACY_CONFLICT" } },
      select: { id: true, email: true, name: true, role: true },
    })) ??
    (await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId },
      select: { id: true, email: true, name: true, role: true },
    })) ??
    (emailNeedle
      ? await prismaPrimary.portalAccount.findFirst({
          where: {
            email: { equals: emailNeedle, mode: "insensitive" },
            accountStatus: { not: "LEGACY_CONFLICT" },
          },
          select: { id: true, email: true, name: true, role: true },
        })
      : null);

  if (!portal) {
    return NextResponse.json(
      { error: "No account is linked to this HRIS user. Re-run the merged-dump import." },
      { status: 409 },
    );
  }

  try {
    await prismaPrimary.portalAccount.updateMany({
      where: { mergedSourceUserId, NOT: { id: portal.id } },
      data: { mergedSourceUserId: null },
    });
    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: {
        mergedSourceUserId,
        staffDesignatedCompanyId: teamId,
      },
    });
  } catch (e) {
    console.warn("company route: could not link mergedSourceUserId", e);
    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: { staffDesignatedCompanyId: teamId },
    });
  }

  if (teamId && (isStaffPortalRole(portal.role) || isPersonnelGuardPortalRole(portal.role))) {
    try {
      await ensureAgentRowForPortalStaff({ email: portal.email, name: portal.name }, teamId);
    } catch (e) {
      console.error("ensureAgentRowForPortalStaff after company update failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    mergedSourceUserId: mergedIdRaw,
    companyName,
    teamId,
    portalAccountId: portal.id,
  });
}
