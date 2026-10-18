/**
 * IAM seed with full wipe (dev / staging).
 *
 * Order:
 *   1. Wipe role_permissions → permissions → roles (users keep their rows; role_id → null)
 *   2. Re-seed the permission catalog and the three system roles + grants
 *   3. Optional (--wipe-users): delete imported (HRIS-linked) users
 *   4. Re-import users from the merged dump (skip with --skip-import)
 *   5. Assign roles: seed-config promotions → legacy role → Employee (customers stay role-less)
 *   6. Ensure the break-glass Super Admin account exists
 *
 * Guardrails: refuses to run when NODE_ENV=production unless --confirm-wipe is
 * passed. Never point this at production without a separate, manual runbook.
 *
 * Usage:
 *   npm run db:seed:iam -- --dry-run
 *   npm run db:seed:iam
 *
 * Env (optional):
 *   IAM_SEED_SUPER_ADMINS / IAM_SEED_ADMINS   comma-separated emails or usernames to promote
 *   ADMIN_EMAILS                              also promoted to Super Admin
 *   IAM_BREAK_GLASS_EMAIL / _USERNAME / _PASSWORD
 *   MERGED_IMPORT_DATABASE_URL                merged dump (MySQL) to import from
 */
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  ACCOUNT_STATUS_ACTIVE,
  accountStatusIsActive,
} from "../src/modules/platform/rbac/account-status";
import { importMergedUsers, readMergedDump } from "../src/modules/platform/auth/merged-user-import";
import { PERMISSION_CATALOG } from "../src/modules/platform/rbac/permission-catalog";
import {
  RBAC_ROLE_DEFINITIONS,
  SUPER_ADMIN_ROLE_KEY,
  grantsForRoleDefinition,
  legacyPortalRoleForRbacRoleKey,
  parseIdentifierList,
  planSeedRoleKey,
  type RolePromotions,
} from "../src/modules/platform/rbac/rbac-seed";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmWipe = args.has("--confirm-wipe");
const wipeUsers = args.has("--wipe-users");
const skipImport = args.has("--skip-import");

function describeTarget(): string {
  const raw = process.env.DATABASE_URL_PRIMARY?.trim() || process.env.DATABASE_URL?.trim() || "";
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unknown)";
  }
}

function assertWipeAllowed() {
  if (process.env.NODE_ENV === "production" && !confirmWipe) {
    console.error(
      "[seed-iam] Refusing to wipe IAM data with NODE_ENV=production. " +
        "Use the manual production runbook, or pass --confirm-wipe for staging.",
    );
    process.exit(1);
  }
}

function promotionsFromEnv(): RolePromotions {
  return {
    superAdmins: [
      ...parseIdentifierList(process.env.IAM_SEED_SUPER_ADMINS),
      ...parseIdentifierList(process.env.ADMIN_EMAILS),
    ],
    admins: parseIdentifierList(process.env.IAM_SEED_ADMINS),
  };
}

async function wipeAndSeedRoles(): Promise<Map<string, string>> {
  return prismaPrimary.$transaction(async (tx) => {
    await tx.portalAccount.updateMany({ where: { roleId: { not: null } }, data: { roleId: null } });
    const grants = await tx.rolePermission.deleteMany();
    const permissions = await tx.permission.deleteMany();
    const roles = await tx.role.deleteMany();
    console.log(
      `[seed-iam] wiped ${grants.count} grants, ${permissions.count} permissions, ${roles.count} roles`,
    );

    await tx.permission.createMany({
      data: PERMISSION_CATALOG.map((p) => ({
        key: p.key,
        resource: p.resource,
        action: p.action,
        description: p.description,
      })),
    });
    const permissionRows = await tx.permission.findMany({ select: { id: true, key: true } });
    const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

    const roleIdByKey = new Map<string, string>();
    for (const def of RBAC_ROLE_DEFINITIONS) {
      const role = await tx.role.create({
        data: { key: def.key, name: def.name, description: def.description, isSystem: true },
      });
      roleIdByKey.set(def.key, role.id);
      const rows = grantsForRoleDefinition(def).map((key) => ({
        roleId: role.id,
        permissionId: permissionIdByKey.get(key)!,
      }));
      await tx.rolePermission.createMany({ data: rows });
      console.log(`[seed-iam] role ${def.key}: ${rows.length} grants`);
    }
    return roleIdByKey;
  });
}

async function wipeImportedUsers(keepEmail: string) {
  const result = await prismaPrimary.portalAccount.deleteMany({
    where: { mergedSourceUserId: { not: null }, NOT: { email: keepEmail } },
  });
  console.log(`[seed-iam] deleted ${result.count} imported (HRIS-linked) users`);
}

async function importFromDump() {
  try {
    const rows = await readMergedDump();
    const summary = await importMergedUsers(rows, { dryRun, log: (m) => console.log(m) });
    if (summary.conflicts.length > 0) {
      console.warn("[seed-iam] import conflicts:", JSON.stringify(summary.conflicts, null, 2));
    }
    if (summary.errors.length > 0) {
      console.warn("[seed-iam] import errors:", JSON.stringify(summary.errors, null, 2));
    }
  } catch (e) {
    console.warn(
      "[seed-iam] merged dump import skipped:",
      e instanceof Error ? e.message.split("\n")[0] : e,
    );
  }
}

async function assignRoles(roleIdByKey: Map<string, string>, promotions: RolePromotions) {
  const users = await prismaPrimary.portalAccount.findMany({
    select: { id: true, email: true, username: true, role: true, roleId: true, accountStatus: true },
  });
  const counts = new Map<string, number>();
  let writes = 0;
  for (const user of users) {
    const roleKey = planSeedRoleKey(
      {
        email: user.email,
        username: user.username,
        legacyRole: user.role,
        accountStatus: user.accountStatus,
      },
      promotions,
    );
    counts.set(roleKey ?? "(none)", (counts.get(roleKey ?? "(none)") ?? 0) + 1);
    const roleId = roleKey ? roleIdByKey.get(roleKey) ?? null : null;
    const legacy = roleKey ? legacyPortalRoleForRbacRoleKey(roleKey, user.role) : user.role;
    if (roleId === user.roleId && legacy === user.role) continue;
    writes += 1;
    if (!dryRun) {
      await prismaPrimary.portalAccount.update({
        where: { id: user.id },
        data: { roleId, role: legacy },
      });
    }
  }
  console.log(
    `[seed-iam] role assignment (${writes} updated): ${JSON.stringify(Object.fromEntries(counts))}`,
  );
}

function breakGlassEmail(): string {
  return (process.env.IAM_BREAK_GLASS_EMAIL?.trim() || "breakglass@iam.local").toLowerCase();
}

async function ensureBreakGlass(superAdminRoleId: string | undefined) {
  const email = breakGlassEmail();
  const wantedUsername =
    process.env.IAM_BREAK_GLASS_USERNAME?.trim().toLowerCase() || "breakglass";
  const envPassword = process.env.IAM_BREAK_GLASS_PASSWORD?.trim() || "";

  const existing = await prismaPrimary.portalAccount.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, accountStatus: true },
  });
  const generated = !envPassword && !existing?.passwordHash;
  const password = envPassword || (generated ? randomBytes(12).toString("base64url") : "");
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;

  if (dryRun || !superAdminRoleId) {
    console.log(`[seed-iam] break-glass ${existing ? "exists" : "would be created"}: ${email}`);
    return;
  }

  if (existing) {
    await prismaPrimary.portalAccount.update({
      where: { id: existing.id },
      data: {
        roleId: superAdminRoleId,
        role: "SuperAdmin",
        ...(accountStatusIsActive(existing.accountStatus)
          ? {}
          : { accountStatus: ACCOUNT_STATUS_ACTIVE }),
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
  } else {
    const usernameTaken =
      (await prismaPrimary.portalAccount.count({
        where: { username: { equals: wantedUsername, mode: "insensitive" } },
      })) > 0;
    await prismaPrimary.portalAccount.create({
      data: {
        id: randomUUID(),
        email,
        username: usernameTaken ? null : wantedUsername,
        name: "Break-glass Super Admin",
        role: "SuperAdmin",
        roleId: superAdminRoleId,
        passwordHash: passwordHash ?? null,
        accountStatus: ACCOUNT_STATUS_ACTIVE,
      },
    });
  }
  console.log(`[seed-iam] break-glass Super Admin ensured: ${email}`);
  if (generated) {
    console.log(`[seed-iam] generated break-glass password (shown once): ${password}`);
  }
}

async function main() {
  console.log(`[seed-iam] target: ${describeTarget()}${dryRun ? " (dry run)" : ""}`);
  assertWipeAllowed();
  const promotions = promotionsFromEnv();

  let roleIdByKey: Map<string, string>;
  if (dryRun) {
    const roles = await prismaPrimary.role.findMany({ select: { id: true, key: true } });
    roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
    console.log("[seed-iam] dry run: skipping wipe; roles/grants would be re-created");
  } else {
    roleIdByKey = await wipeAndSeedRoles();
  }

  if (wipeUsers && !dryRun) await wipeImportedUsers(breakGlassEmail());
  if (!skipImport) await importFromDump();

  await assignRoles(roleIdByKey, promotions);
  await ensureBreakGlass(roleIdByKey.get(SUPER_ADMIN_ROLE_KEY));

  const activeSuperAdmins = await prismaPrimary.portalAccount.count({
    where: {
      rbacRole: { key: SUPER_ADMIN_ROLE_KEY },
      accountStatus: ACCOUNT_STATUS_ACTIVE,
    },
  });
  console.log(`[seed-iam] done. active Super Admins: ${activeSuperAdmins}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
