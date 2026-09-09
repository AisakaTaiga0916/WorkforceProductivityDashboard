import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { mapPortalRoleToMergedHrisRole } from "@/lib/auth/portal-to-merged-role";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { setPortalStaffAssignmentColor } from "@/lib/portal-staff-assignment-color-sql";
import { prismaPrimary, prismaSecondary } from "@/lib/prisma";
import { withSecondaryWriteClient } from "@/lib/prisma-secondary-write";
import { Prisma } from "@prisma/client/secondary";
import {
  isPlatformSuperAdminPortalRole,
  isStaffPortalRole,
  normalizePortalRole,
} from "@/lib/staff-role";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";

const ORG_CHART_PORTAL_ROLES = new Set(["Personnel", "Admin", "HighAdmin"]);

/**
 * PATCH /api/admin/org-chart/portal-role
 * SuperAdmin: set Personnel / Admin / HighAdmin from the Org Chart.
 * Reflects on Workforce ListView via portal_accounts.role.
 *
 * Body: { nodeId?: string, mergedSourceUserId?: string, role: "Personnel"|"Admin"|"HighAdmin" }
 */
export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json(
      { error: "Only a SuperAdmin may set portal roles from the Org Chart." },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      nodeId?: string;
      mergedSourceUserId?: string;
      role?: string;
    };

    const portalRole = normalizePortalRole(body.role?.trim() ?? "");
    if (!portalRole || !ORG_CHART_PORTAL_ROLES.has(portalRole)) {
      return NextResponse.json(
        { error: "Role must be Personnel, Admin, or HighAdmin." },
        { status: 400 },
      );
    }

    let mergedId = (body.mergedSourceUserId ?? "").trim();
    let nodeId = (body.nodeId ?? "").trim();

    if (nodeId && !mergedId) {
      const node = await prismaPrimary.orgChartNode.findUnique({
        where: { id: nodeId },
        select: { id: true, mergedSourceUserId: true, personName: true },
      });
      if (!node) {
        return NextResponse.json({ error: "Org chart person not found." }, { status: 404 });
      }
      mergedId = (node.mergedSourceUserId ?? "").trim();
      if (!mergedId) {
        return NextResponse.json(
          { error: "This org-chart person is not linked to an HRIS user." },
          { status: 400 },
        );
      }
    }

    if (!/^\d+$/.test(mergedId)) {
      return NextResponse.json(
        { error: "mergedSourceUserId or nodeId with HRIS link is required." },
        { status: 400 },
      );
    }

    const mergedSourceUserId = BigInt(mergedId);
    const sourceTags = resolveHrisSourceTags();
    const mergedHrisRole = mapPortalRoleToMergedHrisRole(portalRole);

    const mergedRows = await prismaSecondary.$queryRaw<
      Array<{
        source_user_id: bigint;
        name: string;
        email: string | null;
        username: string | null;
      }>
    >`
      SELECT source_user_id, name, email, username
      FROM merged_users
      WHERE source_user_id = ${mergedSourceUserId}
        AND (source_database IN (${Prisma.join(sourceTags)}) OR source_user_id >= 9000000000)
        AND is_active = 1
      LIMIT 1
    `;
    const merged = mergedRows[0];
    if (!merged) {
      return NextResponse.json({ error: "HRIS user not found." }, { status: 404 });
    }

    let portal = await prismaPrimary.portalAccount.findFirst({
      where: {
        mergedSourceUserId,
        accountStatus: { not: "LEGACY_CONFLICT" },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        staffDesignatedCompanyId: true,
      },
    });

    if (!portal) {
      const email =
        merged.email?.trim().toLowerCase() ||
        `${(merged.username ?? mergedId).toLowerCase()}@hris.merged`;
      portal = await prismaPrimary.portalAccount.create({
        data: {
          email,
          name: merged.name,
          username: merged.username?.trim() || null,
          role: portalRole,
          mergedSourceUserId,
          headPrivileges: portalRole === "Admin",
          accountStatus: "ACTIVE",
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          staffDesignatedCompanyId: true,
        },
      });
    }

    if (isPlatformSuperAdminPortalRole(portal.role) && portalRole !== "SuperAdmin") {
      // Allow demoting SuperAdmin from org chart only via explicit SuperAdmin choice elsewhere.
      return NextResponse.json(
        {
          error:
            "This person is a platform SuperAdmin. Change that role from ListView (SuperAdmin option), not Org Chart.",
        },
        { status: 400 },
      );
    }

    // If demoting a section head to Personnel, clear head pointers so reconcile won't re-promote.
    if (portalRole === "Personnel") {
      const headed = await prismaPrimary.orgChartSection.findMany({
        where: {
          headNode: { mergedSourceUserId: mergedId },
        },
        select: { id: true },
      });
      if (headed.length > 0) {
        await prismaPrimary.orgChartSection.updateMany({
          where: { id: { in: headed.map((h) => h.id) } },
          data: { headNodeId: null },
        });
      }
    }

    const isSectionHead = await prismaPrimary.orgChartSection.findFirst({
      where: { headNode: { mergedSourceUserId: mergedId } },
      select: { id: true },
    });

    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: {
        role: portalRole,
        // Chart head + Admin → headPrivileges; HighAdmin / Personnel → false
        headPrivileges: portalRole === "Admin" && Boolean(isSectionHead),
      },
    });

    try {
      await withSecondaryWriteClient(async (db) => {
        await db.$executeRaw`
          UPDATE merged_users
          SET role = ${mergedHrisRole}, updated_at = CURRENT_TIMESTAMP
          WHERE source_user_id = ${mergedSourceUserId}
        `;
      });
    } catch (e) {
      console.warn("org-chart portal-role: merged_users sync skipped", e);
    }

    if (isStaffPortalRole(portalRole)) {
      try {
        await setPortalStaffAssignmentColor(portal.id, null);
      } catch {
        /* ignore */
      }
      if (portal.staffDesignatedCompanyId) {
        try {
          await ensureAgentRowForPortalStaff(
            { email: portal.email, name: portal.name },
            portal.staffDesignatedCompanyId,
          );
        } catch (e) {
          console.error("ensureAgentRowForPortalStaff after org-chart role failed", e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      role: portalRole,
      mergedSourceUserId: mergedId,
      nodeId: nodeId || null,
      clearedHead: portalRole === "Personnel",
    });
  } catch (e) {
    console.error("PATCH /api/admin/org-chart/portal-role failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update portal role." },
      { status: 500 },
    );
  }
}
