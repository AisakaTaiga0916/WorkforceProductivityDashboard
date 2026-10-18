import bcrypt from "bcryptjs";
import { verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import type { PortalRow } from "@/lib/portal-account";

export type PortalCredentialRow = PortalRow;

const portalSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  passwordHash: true,
  accountStatus: true,
  companyId: true,
  customerOrgRole: true,
  staffDesignatedCompanyId: true,
  profileImage: true,
  company: { select: { name: true } },
  staffDesignatedCompany: { select: { name: true } },
} as const;

function mapPortalRow(
  row: {
    id: string;
    username: string | null;
    email: string;
    name: string;
    role: string;
    passwordHash: string | null;
    accountStatus: string;
    companyId: string | null;
    customerOrgRole: string | null;
    staffDesignatedCompanyId: string | null;
    profileImage: string | null;
    company: { name: string } | null;
    staffDesignatedCompany: { name: string } | null;
  },
): PortalCredentialRow {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    passwordHash: row.passwordHash,
    accountStatus: row.accountStatus ?? "ACTIVE",
    companyId: row.companyId,
    customerOrgRole: row.customerOrgRole,
    companyName: row.company?.name ?? null,
    staffDesignatedCompanyId: row.staffDesignatedCompanyId,
    staffDesignatedCompanyName: row.staffDesignatedCompany?.name ?? null,
    profileImage: row.profileImage,
  };
}

/**
 * Resolve portal account by email, current username, or registered alias username.
 * Used for password login (main-DB credentials) and session/profile lookup.
 */
export async function findPortalAccountByLogin(loginId: string): Promise<PortalCredentialRow | null> {
  const trimmed = loginId.trim();
  if (!trimmed) return null;
  const needle = trimmed.toLowerCase();

  const byEmailOrUsername = await prismaPrimary.portalAccount.findFirst({
    where: {
      accountStatus: { not: "LEGACY_CONFLICT" },
      OR: [
        { email: { equals: trimmed, mode: "insensitive" } },
        { username: { equals: trimmed, mode: "insensitive" } },
      ],
    },
    select: portalSelect,
  });
  if (byEmailOrUsername) return mapPortalRow(byEmailOrUsername);

  const alias = await prismaPrimary.portalUsernameAlias.findFirst({
    where: { username: { equals: needle, mode: "insensitive" } },
    select: { portalAccountId: true },
  });
  if (!alias) return null;

  const byAlias = await prismaPrimary.portalAccount.findFirst({
    where: {
      id: alias.portalAccountId,
      accountStatus: { not: "LEGACY_CONFLICT" },
    },
    select: portalSelect,
  });
  return byAlias ? mapPortalRow(byAlias) : null;
}

/** Verify password against PortalAccount.passwordHash (bcrypt). */
export async function verifyPortalAccountPassword(
  portal: Pick<PortalCredentialRow, "passwordHash">,
  password: string,
): Promise<boolean> {
  const result = await verifyPortalPassword(portal.passwordHash, password);
  return result.ok && !result.oauthOnly;
}

/** Hash a plaintext password for storage on portal_accounts.password_hash. */
export async function hashPortalPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
