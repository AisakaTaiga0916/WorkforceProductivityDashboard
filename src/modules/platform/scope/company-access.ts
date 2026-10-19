/**
 * Company access (Phase 2): memberships, Super Admin global access, and the
 * shell company switcher context.
 *
 * - Access boundary is the company: `canAccessCompany(access, companyId)`.
 * - The current company comes from the switcher cookie (validated against
 *   memberships on every request) and falls back to the default membership.
 * - Teams are org structure *inside* a company and never grant access.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { prisma } from "@/modules/platform/db/prisma";
import { isElevatedPlatformRole } from "@/lib/staff-role";
import { loadCompanyDirectory } from "@/modules/platform/companies/company-directory";
import {
  CURRENT_COMPANY_COOKIE,
  canAccessCompany,
  pickCurrentCompanyId,
  type AccessibleCompany,
  type CompanyAccess,
} from "./company-access-core";

export {
  ALL_COMPANIES_VALUE,
  CURRENT_COMPANY_COOKIE,
  canAccessCompany,
  type AccessibleCompany,
  type CompanyAccess,
} from "./company-access-core";

type MembershipRow = { companyId: string; isDefault: boolean };

async function findPortalAccount(userId: string | null, email: string | null) {
  const select = { id: true, staffDesignatedCompanyId: true } as const;
  if (userId) {
    const byId = await prisma.portalAccount.findUnique({ where: { id: userId }, select });
    if (byId) return byId;
  }
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  return prisma.portalAccount.findUnique({ where: { email: e }, select });
}

/**
 * Membership rows for an account. Self-heals accounts that predate
 * `user_companies` (designated company but no rows) into a default membership.
 */
export async function loadCompanyMemberships(
  portalAccountId: string,
  designatedCompanyId?: string | null,
): Promise<MembershipRow[]> {
  const rows = await prisma.userCompany.findMany({
    where: { portalAccountId },
    select: { companyId: true, isDefault: true },
  });
  if (rows.length > 0 || !designatedCompanyId) return rows;
  await prisma.userCompany.upsert({
    where: { portalAccountId_companyId: { portalAccountId, companyId: designatedCompanyId } },
    create: { portalAccountId, companyId: designatedCompanyId, isDefault: true },
    update: {},
  });
  return [{ companyId: designatedCompanyId, isDefault: true }];
}

const loadCompanyAccessCached = cache(
  async (userId: string | null, email: string | null, role: string): Promise<CompanyAccess> => {
    const [directory, account] = await Promise.all([
      loadCompanyDirectory(),
      findPortalAccount(userId, email),
    ]);
    const global = isElevatedPlatformRole(role);
    const memberships = account
      ? await loadCompanyMemberships(account.id, account.staffDesignatedCompanyId)
      : [];
    const memberIds = new Set(memberships.map((m) => m.companyId));
    const defaultRow = memberships.find((m) => m.isDefault);

    const companies: AccessibleCompany[] = directory.active
      .filter((c) => global || memberIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, isDefault: c.id === defaultRow?.companyId }));
    const defaultCompanyId =
      defaultRow && companies.some((c) => c.id === defaultRow.companyId) ? defaultRow.companyId : null;

    let cookieValue: string | undefined;
    try {
      cookieValue = (await cookies()).get(CURRENT_COMPANY_COOKIE)?.value;
    } catch {
      cookieValue = undefined; // Outside a request (jobs / scripts).
    }

    return {
      portalAccountId: account?.id ?? null,
      global,
      companies,
      defaultCompanyId,
      currentCompanyId: pickCurrentCompanyId({
        portalAccountId: account?.id ?? null,
        global,
        companies,
        defaultCompanyId,
        cookieValue,
      }),
    };
  },
);

/** Company access + current switcher context for the signed-in user (request-cached). */
export async function getCompanyAccess(session: Session | null | undefined): Promise<CompanyAccess> {
  return loadCompanyAccessCached(
    session?.user?.id ?? null,
    session?.user?.email?.trim().toLowerCase() ?? null,
    session?.user?.role ?? "",
  );
}

/** The viewer's current company id (switcher), or null for "All companies" / none. */
export async function resolveViewerCompanyId(
  session: Session | null | undefined,
): Promise<string | null> {
  return (await getCompanyAccess(session)).currentCompanyId;
}

export async function viewerCanAccessCompany(
  session: Session | null | undefined,
  companyId: string | null | undefined,
): Promise<boolean> {
  return canAccessCompany(await getCompanyAccess(session), companyId);
}

/**
 * Company filter for a viewer-scoped list:
 * - explicit `requested` company when the viewer may access it,
 * - else the current company context,
 * - `null` only for global users on "All companies" (no filter).
 * Non-global users with no company get `"__none__"` so filters match nothing.
 */
export async function resolveViewerCompanyFilter(
  session: Session | null | undefined,
  requested?: string | null,
): Promise<string | null> {
  const access = await getCompanyAccess(session);
  const wanted = requested?.trim();
  if (wanted === "ALL" && access.global) return null;
  if (wanted && wanted !== "ALL" && canAccessCompany(access, wanted)) return wanted;
  if (access.currentCompanyId) return access.currentCompanyId;
  return access.global ? null : "__none__";
}
