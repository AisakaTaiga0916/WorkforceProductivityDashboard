/**
 * Company membership writes (`user_companies`). Every writer goes through here
 * so `portal_accounts.staff_designated_company_id` stays a mirror of the
 * default membership for legacy readers.
 */

import type { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";

type Tx = Prisma.TransactionClient;

/**
 * Replace a user's memberships with exactly `companyIds` and mark `defaultCompanyId`.
 * Callers validate input (`normalizeMembershipInput`) and permissions.
 */
export async function setUserCompanyMemberships(
  portalAccountId: string,
  companyIds: readonly string[],
  defaultCompanyId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userCompany.deleteMany({
      where: { portalAccountId, companyId: { notIn: [...companyIds] } },
    });
    for (const companyId of companyIds) {
      const isDefault = companyId === defaultCompanyId;
      await tx.userCompany.upsert({
        where: { portalAccountId_companyId: { portalAccountId, companyId } },
        create: { portalAccountId, companyId, isDefault },
        update: { isDefault },
      });
    }
    await tx.portalAccount.update({
      where: { id: portalAccountId },
      data: { staffDesignatedCompanyId: defaultCompanyId },
    });
  });
}

async function ensureWith(
  tx: Tx,
  portalAccountId: string,
  companyId: string,
  makeDefault: "ifNone" | "always",
): Promise<void> {
  const existingDefault = await tx.userCompany.findFirst({
    where: { portalAccountId, isDefault: true },
    select: { companyId: true },
  });
  const isDefault = makeDefault === "always" || !existingDefault;
  if (isDefault && existingDefault && existingDefault.companyId !== companyId) {
    await tx.userCompany.updateMany({
      where: { portalAccountId, isDefault: true },
      data: { isDefault: false },
    });
  }
  await tx.userCompany.upsert({
    where: { portalAccountId_companyId: { portalAccountId, companyId } },
    create: { portalAccountId, companyId, isDefault },
    update: isDefault ? { isDefault: true } : {},
  });
  if (isDefault) {
    await tx.portalAccount.update({
      where: { id: portalAccountId },
      data: { staffDesignatedCompanyId: companyId },
    });
  }
}

/**
 * Add a membership (HRIS import / sync / account creation). With `"ifNone"`
 * (default) it only becomes the default when the user has no default yet, so
 * Super Admin assignments in User Management are never overwritten.
 */
export async function ensureCompanyMembership(
  portalAccountId: string,
  companyId: string,
  opts?: { makeDefault?: "ifNone" | "always"; tx?: Tx },
): Promise<void> {
  const makeDefault = opts?.makeDefault ?? "ifNone";
  if (opts?.tx) return ensureWith(opts.tx, portalAccountId, companyId, makeDefault);
  await prisma.$transaction((tx) => ensureWith(tx, portalAccountId, companyId, makeDefault));
}

/** Remove every membership (e.g. account converted to Super Admin-only or customer). */
export async function clearCompanyMemberships(portalAccountId: string): Promise<void> {
  await prisma.$transaction([
    prisma.userCompany.deleteMany({ where: { portalAccountId } }),
    prisma.portalAccount.update({
      where: { id: portalAccountId },
      data: { staffDesignatedCompanyId: null },
    }),
  ]);
}

/** Copy every membership of `fromId` onto `toId` (legacy-conflict merge); keeps `toId`'s default. */
export async function copyCompanyMemberships(fromId: string, toId: string): Promise<void> {
  const rows = await prisma.userCompany.findMany({
    where: { portalAccountId: fromId },
    select: { companyId: true, isDefault: true },
  });
  for (const row of rows) {
    await ensureCompanyMembership(toId, row.companyId, { makeDefault: "ifNone" });
  }
}

export async function loadMembershipsByAccountIds(
  portalAccountIds: readonly string[],
): Promise<Map<string, Array<{ companyId: string; isDefault: boolean }>>> {
  const out = new Map<string, Array<{ companyId: string; isDefault: boolean }>>();
  if (portalAccountIds.length === 0) return out;
  const rows = await prisma.userCompany.findMany({
    where: { portalAccountId: { in: [...portalAccountIds] } },
    select: { portalAccountId: true, companyId: true, isDefault: true },
  });
  for (const row of rows) {
    const list = out.get(row.portalAccountId) ?? [];
    list.push({ companyId: row.companyId, isDefault: row.isDefault });
    out.set(row.portalAccountId, list);
  }
  return out;
}
