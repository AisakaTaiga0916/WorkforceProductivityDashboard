/**
 * Pure helpers for the merged-dump → main `portal_accounts` import.
 * No database access; see `merged-user-import.ts` for the writer.
 */

import { normalizeBcryptPrefix } from "./portal-password";
import {
  ADMIN_ROLE_KEY,
  EMPLOYEE_ROLE_KEY,
  SUPER_ADMIN_ROLE_KEY,
  type SystemRoleKey,
} from "@/modules/platform/rbac/rbac-seed";

/** One `merged_users` row as read from the dump. */
export type MergedDumpUser = {
  sourceUserId: bigint;
  sourceDatabase: string;
  employeeCode: string | null;
  username: string | null;
  passwordHash: string | null;
  name: string;
  email: string | null;
  /** HRIS role (super_admin | high_admin | admin | employee). */
  role: string;
  companyId: bigint | null;
  companyName: string | null;
  department?: string | null;
  position?: string | null;
  isActive: boolean;
};

export function normalizeLoginToken(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/** Email used for the main account; HRIS rows without email get `<username>@hris.merged`. */
export function importEmailForMergedUser(row: Pick<MergedDumpUser, "email" | "username">): string | null {
  const email = normalizeLoginToken(row.email);
  if (email) return email;
  const username = normalizeLoginToken(row.username);
  return username ? `${username}@hris.merged` : null;
}

export function importPasswordHash(hash: string | null | undefined): string | null {
  const h = hash?.trim();
  return h ? normalizeBcryptPrefix(h) : null;
}

/**
 * HRIS role → RBAC role for accounts that have none yet. Matches the existing
 * HRIS mapping (super_admin → Super Admin, high_admin → Admin); everything else
 * is Employee. HRIS `admin` is an HR-system admin, not a company Admin.
 */
export function rbacRoleKeyForHrisRole(hrisRole: string | null | undefined): SystemRoleKey {
  const r = (hrisRole ?? "").trim().toLowerCase();
  if (r === "super_admin") return SUPER_ADMIN_ROLE_KEY;
  if (r === "high_admin") return ADMIN_ROLE_KEY;
  return EMPLOYEE_ROLE_KEY;
}

function rowPreference(row: MergedDumpUser, hrisTags: ReadonlySet<string>): number[] {
  return [
    hrisTags.has(row.sourceDatabase) ? 0 : 1,
    row.isActive ? 0 : 1,
    row.passwordHash?.trim() ? 0 : 1,
  ];
}

function comparePreference(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export type CanonicalSelection = {
  selected: MergedDumpUser[];
  /** Rows dropped because a preferred row already claimed their email/username. */
  duplicates: Array<{ row: MergedDumpUser; keptSourceUserId: bigint }>;
  /** Rows with neither email nor username. */
  unidentifiable: MergedDumpUser[];
};

/**
 * One row per person. Rows sharing an email or username are the same person;
 * preference: HRIS-tagged source → active → has password → lowest source id.
 */
export function selectCanonicalMergedUsers(
  rows: readonly MergedDumpUser[],
  hrisTags: readonly string[],
): CanonicalSelection {
  const tags = new Set(hrisTags);
  const ordered = [...rows].sort((a, b) => {
    const pref = comparePreference(rowPreference(a, tags), rowPreference(b, tags));
    if (pref !== 0) return pref;
    return a.sourceUserId < b.sourceUserId ? -1 : a.sourceUserId > b.sourceUserId ? 1 : 0;
  });

  const claimed = new Map<string, bigint>();
  const selected: MergedDumpUser[] = [];
  const duplicates: CanonicalSelection["duplicates"] = [];
  const unidentifiable: MergedDumpUser[] = [];

  for (const row of ordered) {
    const keys = [
      normalizeLoginToken(row.email),
      normalizeLoginToken(row.username),
    ].filter((k): k is string => Boolean(k));
    if (keys.length === 0) {
      unidentifiable.push(row);
      continue;
    }
    const owner = keys.map((k) => claimed.get(k)).find((v) => v !== undefined);
    if (owner !== undefined) {
      duplicates.push({ row, keptSourceUserId: owner });
      continue;
    }
    for (const k of keys) claimed.set(k, row.sourceUserId);
    selected.push(row);
  }

  return { selected, duplicates, unidentifiable };
}

export type ImportCompany = { id: string; name: string; hrisCompanyId: bigint | null };

/** Resolve the HRIS company to a main-DB team: HRIS id → roster alias → exact name. */
export function resolveImportCompanyId(
  row: Pick<MergedDumpUser, "companyId" | "companyName">,
  companies: readonly ImportCompany[],
  rosterName: string | null,
): string | null {
  if (row.companyId != null) {
    const byHrisId = companies.find((c) => c.hrisCompanyId === row.companyId);
    if (byHrisId) return byHrisId.id;
  }
  const names = [rosterName, row.companyName?.trim() || null]
    .filter((n): n is string => Boolean(n))
    .map((n) => n.toLowerCase());
  for (const name of names) {
    const hit = companies.find((c) => c.name.trim().toLowerCase() === name);
    if (hit) return hit.id;
  }
  return null;
}
