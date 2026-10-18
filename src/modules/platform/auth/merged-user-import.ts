/**
 * Batch import: merged / HRIS dump → main-DB `portal_accounts` (the users table).
 *
 * The merged MySQL database is read once per run and disconnected; the app
 * never queries it for identity at runtime. Conflict rules:
 * - Match an existing user by merged source id → email → username
 *   (legacy-conflict duplicates are never matched or revived).
 * - Profile fields (name, merged link) refresh; email/username only move when free.
 * - Passwords and companies fill gaps only, unless the overwrite flags are set,
 *   so in-app password changes and Super Admin company assignments survive.
 * - HRIS-inactive users are deactivated; the import never re-activates anyone.
 * - Users without a role get one (legacy role, else HRIS role); existing roles
 *   are never changed here.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import {
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_STATUS_INACTIVE,
  ACCOUNT_STATUS_LEGACY_CONFLICT,
  accountStatusIsActive,
} from "@/modules/platform/rbac/account-status";
import {
  importEmailForMergedUser,
  importPasswordHash,
  normalizeLoginToken,
  rbacRoleKeyForHrisRole,
  resolveImportCompanyId,
  selectCanonicalMergedUsers,
  type MergedDumpUser,
} from "./merged-user-import-plan";
import {
  isCustomerLegacyRole,
  legacyPortalRoleForRbacRoleKey,
  resolveLegacyRoleToRbacRoleKey,
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "@/modules/platform/rbac/rbac-seed";

/** Dump source: explicit URL → MERGED_IMPORT_DATABASE_URL → secondary sync/app URLs. */
export function resolveMergedDumpUrl(explicit?: string | null): string {
  const url =
    explicit?.trim() ||
    process.env.MERGED_IMPORT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
    process.env.DATABASE_URL_SECONDARY?.trim();
  if (!url) {
    throw new Error(
      "No merged dump source. Restore the dump into MySQL and set MERGED_IMPORT_DATABASE_URL.",
    );
  }
  return url;
}

type RawMergedRow = {
  source_user_id: bigint;
  source_database: string;
  employee_code: string | null;
  username: string | null;
  password_hash: string | null;
  name: string;
  email: string | null;
  role: string;
  company_id: bigint | null;
  company_name: string | null;
  department: string | null;
  position: string | null;
  is_active: number | boolean;
};

/** Read every `merged_users` row from the dump database, then disconnect. */
export async function readMergedDump(url?: string | null): Promise<MergedDumpUser[]> {
  const client = new PrismaClientSecondary({
    log: ["error"],
    datasources: { db: { url: resolveMergedDumpUrl(url) } },
  });
  try {
    const rows = await client.$queryRawUnsafe<RawMergedRow[]>(`
      SELECT source_user_id, source_database, employee_code, username, password_hash,
             name, email, role, company_id, company_name, department, position, is_active
      FROM merged_users
    `);
    return rows.map((r) => ({
      sourceUserId: BigInt(r.source_user_id),
      sourceDatabase: r.source_database,
      employeeCode: r.employee_code,
      username: r.username,
      passwordHash: r.password_hash,
      name: r.name,
      email: r.email,
      role: r.role,
      companyId: r.company_id == null ? null : BigInt(r.company_id),
      companyName: r.company_name,
      department: r.department,
      position: r.position,
      isActive: Boolean(r.is_active),
    }));
  } finally {
    await client.$disconnect();
  }
}

export type MergedImportOptions = {
  dryRun?: boolean;
  /** Also import non-HRIS rows (e.g. portal_ticketing copies of main-DB accounts). */
  includeNonHrisRows?: boolean;
  overwritePasswords?: boolean;
  overwriteCompany?: boolean;
  log?: (message: string) => void;
};

export type MergedImportSummary = {
  dryRun: boolean;
  sourceRows: number;
  /** Rows written to the main-DB `hris_users` snapshot (0 on dry runs). */
  snapshotRows: number;
  skippedNonHris: number;
  duplicates: number;
  unidentifiable: number;
  skippedInactive: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  rolesAssigned: number;
  passwordsSet: number;
  companiesSet: number;
  aliasesAdded: number;
  conflicts: Array<{ sourceUserId: string; reason: string }>;
  errors: Array<{ sourceUserId: string; error: string }>;
};

type UserRow = {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: string;
  roleId: string | null;
  accountStatus: string;
  passwordHash: string | null;
  staffDesignatedCompanyId: string | null;
  mergedSourceUserId: bigint | null;
};

const userSelect = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  roleId: true,
  accountStatus: true,
  passwordHash: true,
  staffDesignatedCompanyId: true,
  mergedSourceUserId: true,
} as const;

class UserIndex {
  private byMergedId = new Map<bigint, UserRow>();
  private byEmail = new Map<string, UserRow>();
  private byUsername = new Map<string, UserRow>();
  /** Every email / username / alias in use, including legacy-conflict rows. */
  readonly takenEmails = new Set<string>();
  readonly takenLogins = new Set<string>();

  constructor(users: UserRow[], aliases: string[]) {
    for (const u of users) this.add(u);
    for (const a of aliases) this.takenLogins.add(a.toLowerCase());
  }

  add(u: UserRow) {
    const email = u.email.trim().toLowerCase();
    const username = normalizeLoginToken(u.username);
    this.takenEmails.add(email);
    if (username) this.takenLogins.add(username);
    if (u.accountStatus === ACCOUNT_STATUS_LEGACY_CONFLICT) return;
    if (u.mergedSourceUserId != null) this.byMergedId.set(u.mergedSourceUserId, u);
    this.byEmail.set(email, u);
    if (username) this.byUsername.set(username, u);
  }

  holderOfMergedId(id: bigint): UserRow | undefined {
    return this.byMergedId.get(id);
  }

  clearMergedId(id: bigint) {
    this.byMergedId.delete(id);
  }

  match(row: MergedDumpUser, email: string): UserRow | undefined {
    const username = normalizeLoginToken(row.username);
    return (
      this.byMergedId.get(row.sourceUserId) ??
      this.byEmail.get(email) ??
      (username ? this.byUsername.get(username) : undefined)
    );
  }
}

function roleKeyForUnassignedUser(legacyRole: string | null, hrisRole: string): SystemRoleKey {
  if (!legacyRole || isCustomerLegacyRole(legacyRole)) return rbacRoleKeyForHrisRole(hrisRole);
  return resolveLegacyRoleToRbacRoleKey(legacyRole) ?? rbacRoleKeyForHrisRole(hrisRole);
}

export async function importMergedUsers(
  rows: readonly MergedDumpUser[],
  options: MergedImportOptions = {},
): Promise<MergedImportSummary> {
  const dryRun = options.dryRun === true;
  const log = options.log ?? (() => undefined);
  const hrisTags = resolveHrisSourceTags();

  const summary: MergedImportSummary = {
    dryRun,
    sourceRows: rows.length,
    snapshotRows: dryRun ? 0 : await replaceHrisSnapshot(rows),
    skippedNonHris: 0,
    duplicates: 0,
    unidentifiable: 0,
    skippedInactive: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
    rolesAssigned: 0,
    passwordsSet: 0,
    companiesSet: 0,
    aliasesAdded: 0,
    conflicts: [],
    errors: [],
  };

  const scoped = options.includeNonHrisRows
    ? rows
    : rows.filter((r) => hrisTags.includes(r.sourceDatabase));
  summary.skippedNonHris = rows.length - scoped.length;

  const { selected, duplicates, unidentifiable } = selectCanonicalMergedUsers(scoped, hrisTags);
  summary.duplicates = duplicates.length;
  summary.unidentifiable = unidentifiable.length;

  const [users, aliases, companies, roles] = await Promise.all([
    prismaPrimary.portalAccount.findMany({ select: userSelect }),
    prismaPrimary.portalUsernameAlias.findMany({ select: { username: true } }),
    prismaPrimary.team.findMany({ select: { id: true, name: true, hrisCompanyId: true } }),
    prismaPrimary.role.findMany({
      where: { key: { in: [...SYSTEM_ROLE_KEYS] } },
      select: { id: true, key: true },
    }),
  ]);
  const index = new UserIndex(users, aliases.map((a) => a.username));
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
  if (roleIdByKey.size < SYSTEM_ROLE_KEYS.length) {
    log("[import] system roles missing — run `npm run db:seed:iam` to assign roles.");
  }

  for (const row of selected) {
    const sourceUserId = row.sourceUserId.toString();
    const email = importEmailForMergedUser(row);
    if (!email) {
      summary.conflicts.push({ sourceUserId, reason: "no email or username" });
      continue;
    }
    const username = normalizeLoginToken(row.username);
    const name = row.name.trim() || email.split("@")[0] || "User";
    const passwordHash = importPasswordHash(row.passwordHash);
    const companyId = resolveImportCompanyId(
      row,
      companies,
      resolveRosterCompanyName(row.companyName),
    );

    try {
      const existing = index.match(row, email);

      if (!existing) {
        if (!row.isActive) {
          summary.skippedInactive += 1;
          continue;
        }
        if (index.takenEmails.has(email)) {
          summary.conflicts.push({
            sourceUserId,
            reason: `email ${email} is held by a legacy-conflict account`,
          });
          continue;
        }
        const roleKey = rbacRoleKeyForHrisRole(row.role);
        const roleId = roleIdByKey.get(roleKey) ?? null;
        const finalUsername = username && !index.takenLogins.has(username) ? username : null;
        const created: UserRow = {
          id: randomUUID(),
          email,
          username: finalUsername,
          name,
          role: legacyPortalRoleForRbacRoleKey(roleKey),
          roleId,
          accountStatus: ACCOUNT_STATUS_ACTIVE,
          passwordHash,
          staffDesignatedCompanyId: companyId,
          mergedSourceUserId: row.sourceUserId,
        };
        if (!dryRun) {
          await prismaPrimary.portalAccount.create({
            data: { ...created, profileSyncedAt: new Date() },
          });
          if (companyId) {
            await ensureAgentRowForPortalStaff({ email, name }, companyId);
          }
        }
        index.add(created);
        await addEmployeeCodeAlias(row, created, index, dryRun, summary);
        summary.created += 1;
        if (roleId) summary.rolesAssigned += 1;
        if (passwordHash) summary.passwordsSet += 1;
        if (companyId) summary.companiesSet += 1;
        continue;
      }

      const data: Partial<UserRow> & { companyId?: null; customerOrgRole?: null } = {};
      if (existing.name !== name) data.name = name;

      if (existing.mergedSourceUserId !== row.sourceUserId) {
        const holder = index.holderOfMergedId(row.sourceUserId);
        if (holder && holder.id !== existing.id && !dryRun) {
          await prismaPrimary.portalAccount.update({
            where: { id: holder.id },
            data: { mergedSourceUserId: null },
          });
        }
        index.clearMergedId(row.sourceUserId);
        data.mergedSourceUserId = row.sourceUserId;
      }

      if (existing.email.trim().toLowerCase() !== email && !index.takenEmails.has(email)) {
        data.email = email;
      }
      if (
        username &&
        normalizeLoginToken(existing.username) !== username &&
        !index.takenLogins.has(username)
      ) {
        data.username = username;
      }
      if (
        passwordHash &&
        (!existing.passwordHash ||
          (options.overwritePasswords && existing.passwordHash !== passwordHash))
      ) {
        data.passwordHash = passwordHash;
        summary.passwordsSet += 1;
      }
      if (!row.isActive && accountStatusIsActive(existing.accountStatus)) {
        data.accountStatus = ACCOUNT_STATUS_INACTIVE;
        summary.deactivated += 1;
      }
      const setCompany =
        companyId != null &&
        (existing.staffDesignatedCompanyId == null ||
          (options.overwriteCompany === true && existing.staffDesignatedCompanyId !== companyId));
      if (setCompany) {
        data.staffDesignatedCompanyId = companyId;
        summary.companiesSet += 1;
      }
      if (existing.roleId == null && roleIdByKey.size > 0) {
        const roleKey = roleKeyForUnassignedUser(existing.role, row.role);
        const roleId = roleIdByKey.get(roleKey);
        if (roleId) {
          data.roleId = roleId;
          data.role = legacyPortalRoleForRbacRoleKey(roleKey, existing.role);
          if (isCustomerLegacyRole(existing.role)) {
            data.companyId = null;
            data.customerOrgRole = null;
          }
          summary.rolesAssigned += 1;
        }
      }

      if (Object.keys(data).length === 0) {
        summary.unchanged += 1;
      } else {
        if (!dryRun) {
          await prismaPrimary.portalAccount.update({
            where: { id: existing.id },
            data: { ...data, profileSyncedAt: new Date() },
          });
          if (setCompany && companyId) {
            await ensureAgentRowForPortalStaff({ email: data.email ?? existing.email, name }, companyId);
          }
        }
        Object.assign(existing, data);
        index.add(existing);
        summary.updated += 1;
      }
      await addEmployeeCodeAlias(row, existing, index, dryRun, summary);
    } catch (e) {
      summary.errors.push({
        sourceUserId,
        error: e instanceof Error ? e.message.split("\n").slice(-1)[0] : String(e),
      });
    }
  }

  log(
    `[import] ${dryRun ? "(dry run) " : ""}created ${summary.created}, updated ${summary.updated}, unchanged ${summary.unchanged}, deactivated ${summary.deactivated}, roles ${summary.rolesAssigned}, conflicts ${summary.conflicts.length}, errors ${summary.errors.length}`,
  );
  return summary;
}

/** Replace the main-DB `hris_users` snapshot with every dump row (all sources, active or not). */
export async function replaceHrisSnapshot(rows: readonly MergedDumpUser[]): Promise<number> {
  const importedAt = new Date();
  const data = rows.map((r) => ({
    sourceUserId: r.sourceUserId,
    sourceDatabase: r.sourceDatabase,
    employeeCode: r.employeeCode,
    username: r.username,
    name: r.name,
    email: r.email,
    role: r.role,
    companyId: r.companyId,
    companyName: r.companyName,
    department: r.department ?? null,
    position: r.position ?? null,
    isActive: r.isActive,
    importedAt,
  }));
  await prismaPrimary.$transaction([
    prismaPrimary.hrisUser.deleteMany(),
    prismaPrimary.hrisUser.createMany({ data, skipDuplicates: true }),
  ]);
  return data.length;
}

/** Let HRIS employee codes keep working as a login id on the main DB. */
async function addEmployeeCodeAlias(
  row: MergedDumpUser,
  user: UserRow,
  index: UserIndex,
  dryRun: boolean,
  summary: MergedImportSummary,
) {
  const code = normalizeLoginToken(row.employeeCode);
  if (!code || index.takenLogins.has(code)) return;
  if (!dryRun) {
    await prismaPrimary.portalUsernameAlias.create({
      data: { portalAccountId: user.id, username: code, source: "employee_code" },
    });
  }
  index.takenLogins.add(code);
  summary.aliasesAdded += 1;
}
