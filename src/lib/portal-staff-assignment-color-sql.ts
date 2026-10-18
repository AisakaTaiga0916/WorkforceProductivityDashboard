import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";

/**
 * Reads/writes `portal_accounts.staff_assignment_color` via raw SQL so the app
 * keeps working when `prisma generate` could not refresh the client (e.g. Windows
 * EPERM while the app holds the query engine DLL).
 *
 * Uses snake_case table/column names (current primary schema). Falls back to the
 * legacy PascalCase identifiers if those still exist.
 */
export async function loadPortalStaffAssignmentColorMap(): Promise<Map<string, string | null>> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; staff_assignment_color: string | null }[]>(
      Prisma.sql`SELECT id, staff_assignment_color FROM portal_accounts`,
    );
    return new Map(rows.map((r) => [r.id, r.staff_assignment_color]));
  } catch {
    try {
      const rows = await prisma.$queryRaw<{ id: string; staffAssignmentColor: string | null }[]>(
        Prisma.sql`SELECT id, "staffAssignmentColor" FROM "PortalAccount"`,
      );
      return new Map(rows.map((r) => [r.id, r.staffAssignmentColor]));
    } catch {
      return new Map();
    }
  }
}

export async function setPortalStaffAssignmentColor(portalId: string, color: string | null): Promise<void> {
  try {
    if (color === null) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE portal_accounts SET staff_assignment_color = NULL WHERE id = ${portalId}`,
      );
    } else {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE portal_accounts SET staff_assignment_color = ${color} WHERE id = ${portalId}`,
      );
    }
    return;
  } catch {
    /* fall through to legacy table names */
  }

  if (color === null) {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "PortalAccount" SET "staffAssignmentColor" = NULL WHERE id = ${portalId}`,
    );
  } else {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "PortalAccount" SET "staffAssignmentColor" = ${color} WHERE id = ${portalId}`,
    );
  }
}

export async function getPortalStaffAssignmentColor(portalId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ staff_assignment_color: string | null }[]>(
      Prisma.sql`SELECT staff_assignment_color FROM portal_accounts WHERE id = ${portalId} LIMIT 1`,
    );
    return rows[0]?.staff_assignment_color ?? null;
  } catch {
    try {
      const rows = await prisma.$queryRaw<{ staffAssignmentColor: string | null }[]>(
        Prisma.sql`SELECT "staffAssignmentColor" FROM "PortalAccount" WHERE id = ${portalId} LIMIT 1`,
      );
      return rows[0]?.staffAssignmentColor ?? null;
    } catch {
      return null;
    }
  }
}
