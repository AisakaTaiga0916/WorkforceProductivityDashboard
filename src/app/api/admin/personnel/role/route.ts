import { NextResponse } from "next/server";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { requireRole } from "@/lib/access";
import { mapPortalRoleToMergedHrisRole } from "@/lib/auth/portal-to-merged-role";
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "@/lib/auth/sync-portal-profile";
import {
  resolveHrisSourceTags,
  resolveSecondaryDatabaseName,
} from "@/lib/merged-database-sources";
import { setPortalStaffAssignmentColor } from "@/lib/portal-staff-assignment-color-sql";
import { prismaPrimary, prismaSecondary } from "@/lib/prisma";
import { withSecondaryWriteClient } from "@/lib/prisma-secondary-write";
import { Prisma } from "@prisma/client/secondary";
import {
  isPersonnelGuardPortalRole,
  isPlatformSuperAdminPortalRole,
  isStaffPortalRole,
  normalizePortalRole,
  PORTAL_ROLES,
  type PortalRole,
} from "@/lib/staff-role";

const MANAGEABLE = new Set<string>(PORTAL_ROLES);

/**
 * PATCH /api/admin/personnel/role
 * SuperAdmin: set portal role on an HRIS merged user (updates portal; syncs merged_users when allowed).
 * Body: { mergedSourceUserId: string, role: PortalRole }
 */
export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      mergedSourceUserId?: string;
      role?: string;
    };

    const mergedIdRaw = body.mergedSourceUserId?.trim() ?? "";
    if (!/^\d+$/.test(mergedIdRaw)) {
      return NextResponse.json({ error: "mergedSourceUserId is required." }, { status: 400 });
    }

    const roleRaw = body.role?.trim() ?? "";
    const portalRole = normalizePortalRole(roleRaw);
    if (!portalRole || !MANAGEABLE.has(portalRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (portalRole === "SuperAdmin" && session.user.role !== "SuperAdmin") {
      return NextResponse.json(
        { error: "Only a SuperAdmin may assign the platform SuperAdmin portal role." },
        { status: 403 },
      );
    }
    if (portalRole === "HighAdmin" && session.user.role !== "SuperAdmin") {
      return NextResponse.json(
        { error: "Only a SuperAdmin may assign the HighAdmin portal role." },
        { status: 403 },
      );
    }

    const mergedSourceUserId = BigInt(mergedIdRaw);
    const sourceTags = resolveHrisSourceTags();
    const mergedHrisRole = mapPortalRoleToMergedHrisRole(portalRole);

    const mergedRows = await prismaSecondary.$queryRaw<
      Array<{
        source_user_id: bigint;
        name: string;
        username: string | null;
        email: string | null;
        role: string;
        company_name: string | null;
        position: string | null;
        department: string | null;
      }>
    >`
      SELECT source_user_id, name, username, email, role, company_name, position, department
      FROM merged_users
      WHERE source_user_id = ${mergedSourceUserId}
        AND (source_database IN (${Prisma.join(sourceTags)}) OR source_user_id >= 9000000000)
        AND is_active = 1
      LIMIT 1
    `;
    const merged = mergedRows[0];
    if (!merged) {
      return NextResponse.json(
        { error: `HRIS user not found in ${resolveSecondaryDatabaseName()}.` },
        { status: 404 },
      );
    }

    const portalSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      staffDesignatedCompanyId: true,
    } as const;
    const emailNeedle = merged.email?.trim().toLowerCase() || null;
    const usernameNeedle = merged.username?.trim().toLowerCase() || null;

    // Prefer HRIS-linked portal; fall back to email/username (merge may lag the link).
    let portal =
      (await prismaPrimary.portalAccount.findFirst({
        where: { mergedSourceUserId, accountStatus: { not: "LEGACY_CONFLICT" } },
        select: portalSelect,
      })) ??
      (await prismaPrimary.portalAccount.findFirst({
        where: { mergedSourceUserId },
        select: portalSelect,
      })) ??
      (emailNeedle
        ? await prismaPrimary.portalAccount.findFirst({
            where: {
              email: { equals: emailNeedle, mode: "insensitive" },
              accountStatus: { not: "LEGACY_CONFLICT" },
            },
            select: portalSelect,
          })
        : null) ??
      (usernameNeedle
        ? await prismaPrimary.portalAccount.findFirst({
            where: {
              username: { equals: usernameNeedle, mode: "insensitive" },
              accountStatus: { not: "LEGACY_CONFLICT" },
            },
            select: portalSelect,
          })
        : null);

    if (!portal) {
      const profile = canonicalProfileFromMerged({
        sourceUserId: merged.source_user_id,
        username: merged.username,
        name: merged.name,
        email: merged.email,
        role: mergedHrisRole,
        companyName: merged.company_name,
        position: merged.position,
        department: merged.department,
      });
      try {
        await syncPortalProfile(profile, "hris", { forceRoleRefresh: true });
      } catch (e) {
        console.error("syncPortalProfile (role route) failed", e);
        return NextResponse.json(
          { error: "Could not create a portal profile for this HRIS user." },
          { status: 500 },
        );
      }
      portal = await prismaPrimary.portalAccount.findFirst({
        where: {
          OR: [
            { mergedSourceUserId },
            ...(emailNeedle
              ? [{ email: { equals: emailNeedle, mode: "insensitive" as const } }]
              : []),
            ...(usernameNeedle
              ? [{ username: { equals: usernameNeedle, mode: "insensitive" as const } }]
              : []),
          ],
        },
        select: portalSelect,
      });
    }

    if (!portal) {
      return NextResponse.json(
        { error: "Could not create or find a portal account for this user." },
        { status: 500 },
      );
    }

    try {
      await prismaPrimary.portalAccount.updateMany({
        where: { mergedSourceUserId, NOT: { id: portal.id } },
        data: { mergedSourceUserId: null },
      });
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: { mergedSourceUserId },
      });
    } catch (e) {
      console.warn("role route: could not link mergedSourceUserId", e);
    }

    const wasSuper = isPlatformSuperAdminPortalRole(portal.role);
    // Portal is the live role SoT for sessions.
    // Manual Admin from ListView does not set headPrivileges — org-chart reconcile
    // only demotes Admins that were promoted via department headship.
    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: {
        role: portalRole,
        headPrivileges: false,
        ...(portalRole === "SuperAdmin"
          ? { staffDesignatedCompany: { disconnect: true } }
          : {}),
        ...(portalRole !== "Customer"
          ? { company: { disconnect: true }, customerOrgRole: null }
          : {}),
      },
    });

    // Best-effort sync to merged_users via write URL (merge_app is SELECT-only).
    let mergedSynced = false;
    try {
      await withSecondaryWriteClient(async (db) => {
        await db.$executeRaw`
          UPDATE merged_users
          SET role = ${mergedHrisRole}, updated_at = CURRENT_TIMESTAMP
          WHERE source_user_id = ${mergedSourceUserId}
        `;
      });
      mergedSynced = true;
    } catch (e) {
      console.warn(
        "merged_users role sync skipped (portal role still updated):",
        e instanceof Error ? e.message : e,
      );
    }

    if (wasSuper || portalRole === "SuperAdmin") {
      try {
        await setPortalStaffAssignmentColor(portal.id, null);
      } catch (e) {
        console.error("setPortalStaffAssignmentColor after role change failed", e);
      }
    }

    if (
      portal.staffDesignatedCompanyId &&
      (isStaffPortalRole(portalRole) || isPersonnelGuardPortalRole(portalRole))
    ) {
      try {
        await ensureAgentRowForPortalStaff(
          { email: portal.email, name: portal.name },
          portal.staffDesignatedCompanyId,
        );
      } catch (e) {
        console.error("ensureAgentRowForPortalStaff after role update failed", e);
      }
    }

    return NextResponse.json({
      ok: true,
      mergedSourceUserId: mergedIdRaw,
      role: portalRole as PortalRole,
      mergedRole: mergedHrisRole,
      portalAccountId: portal.id,
      mergedSynced,
    });
  } catch (e) {
    console.error("PATCH /api/admin/personnel/role failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update role." },
      { status: 500 },
    );
  }
}
