/**
 * SuperAdmin Settings → Companies (server). Authorization is the caller's job
 * (`companies.read|create|update|archive`). Companies are never hard-deleted:
 * archive keeps tickets, tasks, and memberships for history.
 */

import { prisma } from "@/modules/platform/db/prisma";
import { invalidateCompanyDirectory } from "./company-directory";
import {
  normalizeCompanyAliases,
  normalizeCompanyCode,
  normalizeCompanyLabel,
} from "./company-label";

export type AdminCompany = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  sortOrder: number;
  aliases: string[];
  hasLogo: boolean;
  memberCount: number;
  teamCount: number;
  ticketCount: number;
};

export async function listAdminCompanies(): Promise<AdminCompany[]> {
  const rows = await prisma.company.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
      sortOrder: true,
      aliases: true,
      logoPath: true,
      logoImage: true,
      _count: { select: { memberships: true, orgChartSections: true, tickets: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    aliases: r.aliases,
    hasLogo: Boolean(r.logoPath?.trim() || r.logoImage?.trim()),
    memberCount: r._count.memberships,
    teamCount: r._count.orgChartSections,
    ticketCount: r._count.tickets,
  }));
}

export type CompanyInput = { name?: unknown; code?: unknown; aliases?: unknown };

type NormalizedCompanyInput = {
  name?: string;
  code?: string | null;
  aliases?: string[];
};

/** Validate create/update fields. Pure (uniqueness is checked against `existing`). */
export function validateCompanyInput(
  input: CompanyInput,
  existing: ReadonlyArray<{ id: string; name: string; code: string | null }>,
  opts: { selfId?: string; requireName: boolean },
): NormalizedCompanyInput | { error: string } {
  const out: NormalizedCompanyInput = {};
  const others = existing.filter((c) => c.id !== opts.selfId);

  if (input.name !== undefined || opts.requireName) {
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 2 || name.length > 80) return { error: "Company name must be 2–80 characters." };
    if (others.some((c) => normalizeCompanyLabel(c.name) === normalizeCompanyLabel(name))) {
      return { error: `A company named "${name}" already exists.` };
    }
    out.name = name;
  }

  if (input.code !== undefined) {
    if (input.code !== null && typeof input.code !== "string") return { error: "Invalid code." };
    const code = normalizeCompanyCode(input.code as string | null);
    if (code && !/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(code)) {
      return { error: "Code must be 1–24 letters, numbers, dashes, or underscores." };
    }
    if (code && others.some((c) => c.code === code)) {
      return { error: `Code ${code} is already used by another company.` };
    }
    out.code = code;
  }

  if (input.aliases !== undefined) {
    if (!Array.isArray(input.aliases) || input.aliases.some((a) => typeof a !== "string")) {
      return { error: "Aliases must be a list of labels." };
    }
    const aliases = normalizeCompanyAliases(input.aliases as string[]);
    if (aliases.some((a) => a.length > 80)) return { error: "Aliases must be at most 80 characters." };
    out.aliases = aliases;
  }

  return out;
}

async function existingForValidation() {
  return prisma.company.findMany({ select: { id: true, name: true, code: true } });
}

export async function createCompany(input: CompanyInput): Promise<AdminCompany | { error: string }> {
  const existing = await existingForValidation();
  const parsed = validateCompanyInput(input, existing, { requireName: true });
  if ("error" in parsed) return parsed;
  const last = await prisma.company.aggregate({ _max: { sortOrder: true }, where: { isActive: true } });
  const created = await prisma.company.create({
    data: {
      name: parsed.name!,
      code: parsed.code ?? null,
      aliases: parsed.aliases ?? [],
      sortOrder: (last._max.sortOrder ?? 0) + 10,
    },
    select: { id: true },
  });
  invalidateCompanyDirectory();
  return (await listAdminCompanies()).find((c) => c.id === created.id)!;
}

export async function updateCompany(
  id: string,
  input: CompanyInput & { isActive?: unknown },
): Promise<AdminCompany | { error: string; status?: number }> {
  const current = await prisma.company.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!current) return { error: "Company not found.", status: 404 };

  const existing = await existingForValidation();
  const parsed = validateCompanyInput(input, existing, {
    selfId: id,
    requireName: false,
  });
  if ("error" in parsed) return parsed;

  let isActive: boolean | undefined;
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") return { error: "isActive must be true or false." };
    isActive = input.isActive;
  }

  await prisma.company.update({
    where: { id },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.code !== undefined ? { code: parsed.code } : {}),
      ...(parsed.aliases !== undefined ? { aliases: parsed.aliases } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });
  invalidateCompanyDirectory();
  return (await listAdminCompanies()).find((c) => c.id === id)!;
}

/** Persist display order for the given active company ids (10, 20, 30…). */
export async function reorderCompanies(orderedIds: readonly string[]): Promise<{ error: string } | null> {
  const ids = [...new Set(orderedIds)];
  const known = await prisma.company.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (known.length !== ids.length) return { error: "Unknown company in order list." };
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.company.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } }),
    ),
  );
  invalidateCompanyDirectory();
  return null;
}
