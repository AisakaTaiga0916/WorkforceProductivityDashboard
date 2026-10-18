import { NextResponse } from "next/server";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "@/modules/platform/auth/sync-portal-profile";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import {
  normalizePersonnelAssignmentColor,
} from "@/lib/personnel-assignment-colors";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
  type MergedIdentityRow,
} from "@/lib/sync/merged-person-identity";
import {
  getPortalStaffAssignmentColor,
  setPortalStaffAssignmentColor,
} from "@/lib/portal-staff-assignment-color-sql";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { isStaffPortalRole } from "@/lib/staff-role";
import { Prisma } from "@prisma/client/primary";

/**
 * PATCH /api/admin/personnel/color
 * SuperAdmin/Admin: set assignment color for an HRIS merged user.
 * Ensures a portal_accounts profile exists first (creates one if needed).
 *
 * Body: { mergedSourceUserId: string, staffAssignmentColor: string | null }
 */
export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "users.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    mergedSourceUserId?: string;
    staffAssignmentColor?: string | null;
  };

  const mergedIdRaw = body.mergedSourceUserId?.trim() ?? "";
  if (!/^\d+$/.test(mergedIdRaw)) {
    return NextResponse.json({ error: "mergedSourceUserId is required." }, { status: 400 });
  }
  const mergedSourceUserId = BigInt(mergedIdRaw);
  const sourceTags = resolveHrisSourceTags();

  let colorNext: string | null = null;
  if (body.staffAssignmentColor != null && String(body.staffAssignmentColor).trim() !== "") {
    const normalized = normalizePersonnelAssignmentColor(String(body.staffAssignmentColor));
    if (!normalized) {
      return NextResponse.json(
        { error: "Invalid assignment color. Use a hex code like #FF5733." },
        { status: 400 },
      );
    }
    colorNext = normalized;
  }

  const mergedRows = await prismaPrimary.$queryRaw<
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
    FROM hris_users
    WHERE source_user_id = ${mergedSourceUserId}
      AND source_database IN (${Prisma.join(sourceTags)})
      AND is_active = true
    LIMIT 1
  `;
  const merged = mergedRows[0];
  if (!merged) {
    return NextResponse.json(
      { error: "HRIS user not found. Re-run the merged-dump import if they were added recently." },
      { status: 404 },
    );
  }

  // Prefer an already-linked ACTIVE portal; fall back to LEGACY_CONFLICT, then
  // email/username match (HRIS id may not be linked yet after roster merge).
  const portalSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    staffDesignatedCompanyId: true,
  } as const;
  const emailNeedle = merged.email?.trim().toLowerCase() || null;
  const usernameNeedle = merged.username?.trim().toLowerCase() || null;
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
      role: merged.role,
      companyName: merged.company_name,
      position: merged.position,
      department: merged.department,
    });
    try {
      await syncPortalProfile(profile, "hris", { forceRoleRefresh: true });
    } catch (e) {
      console.error("syncPortalProfile (color route) failed", e);
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
      { error: "Could not create a portal profile for this HRIS user." },
      { status: 500 },
    );
  }

  // Ensure mergedSourceUserId link is set (profile sync / email match may lag the HRIS id).
  if (portal) {
    try {
      // Free the HRIS id if another portal still holds a stale link.
      await prismaPrimary.portalAccount.updateMany({
        where: { mergedSourceUserId, NOT: { id: portal.id } },
        data: { mergedSourceUserId: null },
      });
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: { mergedSourceUserId },
      });
    } catch (e) {
      // Unique conflict — keep color save working.
      console.warn("color route: could not link mergedSourceUserId", e);
    }
  }
  // If company_name maps to a known team and portal has no designated company, attach it.
  if (!portal.staffDesignatedCompanyId && merged.company_name?.trim()) {
    const companyKey = merged.company_name.trim().toLowerCase();
    const team = await prismaPrimary.team.findFirst({
      where: { name: { equals: merged.company_name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    // loose match for HRIS names like MCONPINCO vs MCHISI LPG is left to SuperAdmin company picker
    if (team || companyKey) {
      if (team) {
        await prismaPrimary.portalAccount.update({
          where: { id: portal.id },
          data: { staffDesignatedCompanyId: team.id },
        });
        portal = { ...portal, staffDesignatedCompanyId: team.id };
      }
    }
  }

  try {
    await setPortalStaffAssignmentColor(portal.id, colorNext);
  } catch (e) {
    console.error("setPortalStaffAssignmentColor failed", e);
    return NextResponse.json({ error: "Could not save assignment color." }, { status: 500 });
  }

  /**
   * Propagate the color to every other portal row of the same person (duplicate
   * legacy portals link to synthetic merged ids >= 9e9). Agent/ticket views
   * resolve colors by portal email, so all of the person's rows must agree.
   */
  try {
    const identityRows = await prismaPrimary.$queryRaw<
      Array<{ source_user_id: bigint; name: string; email: string | null }>
    >`
      SELECT source_user_id, name, email
      FROM hris_users
      WHERE is_active = true
    `;
    const canonicalMap = buildCanonicalMergedIdMap(
      identityRows.map(
        (r): MergedIdentityRow => ({
          sourceUserId: r.source_user_id,
          name: r.name,
          email: r.email,
        }),
      ),
    );
    const personIds = identityRows
      .map((r) => r.source_user_id)
      .filter((id) => canonicalMergedId(id, canonicalMap) === mergedSourceUserId);
    const siblingPortals = await prismaPrimary.portalAccount.findMany({
      where: { mergedSourceUserId: { in: personIds }, id: { not: portal.id } },
      select: { id: true },
    });
    for (const sibling of siblingPortals) {
      await setPortalStaffAssignmentColor(sibling.id, colorNext);
    }
  } catch (e) {
    console.error("assignment color propagation to sibling portals failed", e);
  }

  if (portal.staffDesignatedCompanyId && isStaffPortalRole(portal.role)) {
    try {
      await ensureAgentRowForPortalStaff(
        { email: portal.email, name: portal.name },
        portal.staffDesignatedCompanyId,
      );
    } catch (e) {
      console.error("ensureAgentRowForPortalStaff after color update failed", e);
    }
  }

  const saved = await getPortalStaffAssignmentColor(portal.id);
  return NextResponse.json({
    ok: true,
    mergedSourceUserId: mergedIdRaw,
    portalAccountId: portal.id,
    staffAssignmentColor: saved,
  });
}
