/**
 * Keeps `portal_accounts.role_id` aligned with the legacy `role` label for code
 * paths that still create accounts or change roles by label (signup, OAuth/HRIS
 * profile sync, Workforce / Org Chart role routes). Without this, accounts made
 * after the IAM seed would have no role and every permission check would deny.
 */

import { prismaPrimary } from "@/modules/platform/db/prisma";
import { isCustomerLegacyRole, resolveLegacyRoleToRbacRoleKey } from "./rbac-seed";

/** System role id for a legacy label. Customer → `null`; unknown / unseeded → `undefined`. */
export async function rbacRoleIdForLegacyRole(
  legacyRole: string,
): Promise<string | null | undefined> {
  if (isCustomerLegacyRole(legacyRole)) return null;
  const key = resolveLegacyRoleToRbacRoleKey(legacyRole);
  if (!key) return undefined;
  const role = await prismaPrimary.role.findUnique({ where: { key }, select: { id: true } });
  return role?.id;
}

/**
 * Role id to store when the legacy label changes automatically (e.g. org-chart
 * head reconcile). Users on an active custom role keep it (`undefined`).
 */
export async function rbacRoleIdForLegacyChange(
  currentRoleId: string | null,
  nextLegacyRole: string,
): Promise<string | null | undefined> {
  if (currentRoleId) {
    const current = await prismaPrimary.role.findUnique({
      where: { id: currentRoleId },
      select: { isSystem: true, archivedAt: true },
    });
    if (current && !current.isSystem && !current.archivedAt) return undefined;
  }
  return rbacRoleIdForLegacyRole(nextLegacyRole);
}

/** `{ roleId }` scalar patch for an automatic legacy-label change on an existing account. */
export async function roleIdPatchForLegacyChange(
  portalAccountId: string,
  nextLegacyRole: string,
): Promise<{ roleId?: string | null }> {
  const current = await prismaPrimary.portalAccount.findUnique({
    where: { id: portalAccountId },
    select: { roleId: true },
  });
  const roleId = await rbacRoleIdForLegacyChange(current?.roleId ?? null, nextLegacyRole);
  return roleId === undefined ? {} : { roleId };
}

/** Relation-form write for checked Prisma update inputs. */
export function rbacRoleRelationWrite(roleId: string | null | undefined) {
  if (roleId === undefined) return {};
  return roleId === null
    ? { rbacRole: { disconnect: true } }
    : { rbacRole: { connect: { id: roleId } } };
}
