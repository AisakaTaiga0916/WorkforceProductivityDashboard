import { prisma } from "@/modules/platform/db/prisma";
import { isAdminPortalRole } from "@/lib/staff-role";

/**
 * Company Admin coordination (assignment board, KPI assignment within scope):
 * portal role Admin, or legacy headPrivileges / legacy Head row until fully migrated.
 */
export async function portalCompanyAdminPrivilegesForEmail(email: string | null | undefined): Promise<boolean> {
  const e = (email ?? "").trim();
  if (!e) return false;
  const p = await prisma.portalAccount.findFirst({
    where: { email: { equals: e, mode: "insensitive" } },
    select: { headPrivileges: true, role: true },
  });
  if (!p) return false;
  if (isAdminPortalRole(p.role)) return true;
  return p.headPrivileges === true;
}

/** @deprecated use portalCompanyAdminPrivilegesForEmail */
export async function portalHeadPrivilegesForEmail(email: string | null | undefined): Promise<boolean> {
  return portalCompanyAdminPrivilegesForEmail(email);
}
