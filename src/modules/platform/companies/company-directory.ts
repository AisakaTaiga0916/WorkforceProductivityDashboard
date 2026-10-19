/**
 * Company directory (server). Companies are rows in `teams` (Prisma `Company`),
 * managed in SuperAdmin Settings → Companies. Nothing in runtime logic may
 * hardcode company names; resolve labels through this module instead.
 */

import type { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { compareCompanyOrder, matchCompanyByLabel } from "./company-label";

export const ACTIVE_COMPANY_WHERE = { isActive: true } satisfies Prisma.CompanyWhereInput;

export const COMPANY_ORDER_BY = [
  { sortOrder: "asc" },
  { name: "asc" },
] satisfies Prisma.CompanyOrderByWithRelationInput[];

export type CompanyDirectoryEntry = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  sortOrder: number;
  aliases: string[];
};

export type CompanyDirectory = {
  /** Every company (active first by display order, then archived). */
  all: CompanyDirectoryEntry[];
  /** Active companies in display order. */
  active: CompanyDirectoryEntry[];
  byId(id: string | null | undefined): CompanyDirectoryEntry | null;
  /** Resolve a free-text label (name / code / alias) to an active company. */
  resolveLabel(raw: string | null | undefined): CompanyDirectoryEntry | null;
};

const CACHE_TTL_MS = 30_000;
let cached: { at: number; directory: CompanyDirectory } | null = null;

function buildDirectory(rows: CompanyDirectoryEntry[]): CompanyDirectory {
  const all = [...rows].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || compareCompanyOrder(a, b),
  );
  const active = all.filter((c) => c.isActive);
  const byId = new Map(all.map((c) => [c.id, c] as const));
  return {
    all,
    active,
    byId: (id) => (id ? (byId.get(id) ?? null) : null),
    resolveLabel: (raw) => matchCompanyByLabel(raw, active),
  };
}

/** Cached directory (30s TTL; mutations call `invalidateCompanyDirectory`). */
export async function loadCompanyDirectory(): Promise<CompanyDirectory> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.directory;
  const rows = await prisma.company.findMany({
    select: { id: true, name: true, code: true, isActive: true, sortOrder: true, aliases: true },
  });
  const directory = buildDirectory(rows);
  cached = { at: Date.now(), directory };
  return directory;
}

export function invalidateCompanyDirectory(): void {
  cached = null;
}

/** Active companies `{ id, name }` in display order. */
export async function listActiveCompanies(): Promise<Array<{ id: string; name: string }>> {
  const { active } = await loadCompanyDirectory();
  return active.map((c) => ({ id: c.id, name: c.name }));
}

export async function isActiveCompanyId(id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  return (await loadCompanyDirectory()).byId(id)?.isActive === true;
}

/** Resolve a free-text company label to an active company `{ id, name }`. */
export async function resolveCompanyLabel(
  raw: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  const hit = (await loadCompanyDirectory()).resolveLabel(raw);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Canonical company name for a label, or the trimmed label when it matches nothing. */
export async function canonicalCompanyName(raw: string | null | undefined): Promise<string | null> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  return (await loadCompanyDirectory()).resolveLabel(trimmed)?.name ?? trimmed;
}

/** Sort `{ id }` rows by company display order (unknown ids last). */
export async function sortByCompanyOrder<T extends { id: string; name: string }>(
  rows: readonly T[],
): Promise<T[]> {
  const directory = await loadCompanyDirectory();
  const rank = new Map(directory.all.map((c, i) => [c.id, i] as const));
  return [...rows].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
}

