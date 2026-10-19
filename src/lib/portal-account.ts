import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { rbacRoleIdForLegacyRole, rbacRoleRelationWrite } from "@/modules/platform/rbac/rbac-role-sync";
import { prisma } from "@/modules/platform/db/prisma";
const SALT_ROUNDS = 12;

export type PortalRow = {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: string;
  passwordHash: string | null;
  accountStatus: string;
  companyId: string | null;
  customerOrgRole: string | null;
  companyName: string | null;
  staffDesignatedCompanyId: string | null;
  staffDesignatedCompanyName: string | null;
  profileImage: string | null;
};

/** Match portal row by unique username, email, or legacy username alias. */
export async function findPortalByLogin(loginId: string): Promise<PortalRow | null> {
  const { findPortalAccountByLogin } = await import("@/modules/platform/auth/portal-credentials");
  return findPortalAccountByLogin(loginId);
}

export async function findPortalByUsername(username: string): Promise<PortalRow | null> {
  const u = username.trim();
  if (!u) return null;
  const row = await prisma.portalAccount.findFirst({
    where: { username: { equals: u, mode: "insensitive" } },
    select: {
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
    },
  });
  if (!row) return null;
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

export async function findPortalByEmailOnly(email: string): Promise<PortalRow | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const row = await prisma.portalAccount.findFirst({
    where: { email: { equals: e, mode: "insensitive" } },
    select: {
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
    },
  });
  if (!row) return null;
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

const SIGNUP_ROLES = ["Customer", "Personnel"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export function isSignupRole(r: string): r is SignupRole {
  return (SIGNUP_ROLES as readonly string[]).includes(r);
}

/** Customer self-signup with username and password. */
export async function createPortalAccount(input: {
  username: string;
  email: string;
  name: string;
  password: string;
  role: SignupRole;
  companyId?: string | null;
  customerOrgRole?: string | null;
}): Promise<{ ok: true } | { ok: false; code: "DUPLICATE" | "ERROR" }> {
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const role = input.role;
  let companyId: string | null = null;
  let customerOrgRole: string | null = null;
  if (role === "Customer") {
    companyId = input.companyId?.trim() ? input.companyId!.trim() : null;
    const org = (input.customerOrgRole ?? "").trim();
    const normalized = org === "Head" ? "Admin" : org;
    customerOrgRole = ["Admin", "Personnel"].includes(normalized) ? normalized : null;
  }
  try {
    const roleId = await rbacRoleIdForLegacyRole(role);
    await prisma.portalAccount.create({
      data: {
        id,
        username,
        email,
        name: input.name.trim(),
        passwordHash,
        role,
        ...(companyId
          ? { company: { connect: { id: companyId } }, ...rbacRoleRelationWrite(roleId ?? undefined) }
          : { companyId: null, roleId: roleId ?? null }),
        customerOrgRole,
      },
    });
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const duplicate = msg.includes("Unique") || msg.includes("duplicate");
    return { ok: false, code: duplicate ? "DUPLICATE" : "ERROR" };
  }
}

/** @deprecated Prefer {@link syncOAuthUser} from `@/modules/platform/auth/sync-oauth-user`. */
export async function upsertPortalOAuthAccount(input: {
  email: string;
  name: string;
  role?: string;
  profileImage?: string | null;
  provider?: string;
  providerAccountId?: string;
}): Promise<PortalRow | null> {
  const { syncOAuthUser } = await import("@/modules/platform/auth/sync-oauth-user");
  const email = input.email.trim().toLowerCase();
  if (!email) return null;
  await syncOAuthUser({
    email,
    name: input.name,
    image: input.profileImage,
    provider: input.provider ?? "google",
    providerAccountId: input.providerAccountId ?? email,
    roleHint: input.role ?? null,
  });
  return findPortalByEmailOnly(email);
}
