import { Prisma } from "@prisma/client/primary";
import { normalizePersonName } from "@/lib/person-name";
import { prisma } from "@/modules/platform/db/prisma";
import { isStaffPortalRole } from "@/lib/staff-role";

export type AgentColorIdentity = {
  email?: string | null | undefined;
  name?: string | null | undefined;
};

type PortalColorRow = { e: string; c: string | null; r: string; n: string };

/**
 * Load portal assignment colors by email (snake_case first, legacy PascalCase fallback).
 * Matches {@link loadPortalStaffAssignmentColorMap} table/column naming.
 */
async function queryPortalColorsByEmails(uniqueEmails: string[]): Promise<PortalColorRow[]> {
  if (uniqueEmails.length === 0) return [];
  const emailList = Prisma.join(uniqueEmails.map((x) => Prisma.sql`${x}`));

  try {
    return await prisma.$queryRaw<PortalColorRow[]>(
      Prisma.sql`
        SELECT LOWER(TRIM(email)) AS e,
               staff_assignment_color AS c,
               role AS r,
               name AS n
        FROM portal_accounts
        WHERE LOWER(TRIM(email)) IN (${emailList})
      `,
    );
  } catch {
    /* fall through */
  }

  try {
    return await prisma.$queryRaw<PortalColorRow[]>(
      Prisma.sql`
        SELECT LOWER(TRIM(email)) AS e,
               "staffAssignmentColor" AS c,
               role AS r,
               name AS n
        FROM "PortalAccount"
        WHERE LOWER(TRIM(email)) IN (${emailList})
      `,
    );
  } catch {
    return [];
  }
}

async function loadStaffPortalColorsByNormalizedName(): Promise<Map<string, string | null>> {
  const nameToColor = new Map<string, string | null>();

  try {
    const rows = await prisma.$queryRaw<
      Array<{ name: string; role: string; staff_assignment_color: string | null }>
    >(
      Prisma.sql`
        SELECT name, role, staff_assignment_color
        FROM portal_accounts
      `,
    );
    for (const p of rows) {
      if (!isStaffPortalRole(p.role)) continue;
      const nk = normalizePersonName(p.name);
      if (!nk || nameToColor.has(nk)) continue;
      nameToColor.set(nk, p.staff_assignment_color ?? null);
    }
    return nameToColor;
  } catch {
    /* fall through */
  }

  try {
    const all = await prisma.portalAccount.findMany({
      select: { name: true, role: true, staffAssignmentColor: true },
    });
    for (const p of all) {
      if (!isStaffPortalRole(p.role)) continue;
      const nk = normalizePersonName(p.name);
      if (!nk || nameToColor.has(nk)) continue;
      nameToColor.set(nk, p.staffAssignmentColor ?? null);
    }
  } catch {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ name: string; role: string; staffAssignmentColor: string | null }>
      >(
        Prisma.sql`
          SELECT name, role, "staffAssignmentColor"
          FROM "PortalAccount"
        `,
      );
      for (const p of rows) {
        if (!isStaffPortalRole(p.role)) continue;
        const nk = normalizePersonName(p.name);
        if (!nk || nameToColor.has(nk)) continue;
        nameToColor.set(nk, p.staffAssignmentColor ?? null);
      }
    } catch {
      /* ignore */
    }
  }

  return nameToColor;
}

/**
 * Maps **Agent roster email** (lower-trim) → portal `staffAssignmentColor` for Admin/Personnel.
 *
 * Uses raw SQL for email matches (Prisma client may lag the schema), then falls back to
 * **normalized display name** when no portal row shares the agent email — same idea as
 * `pickCanonicalAgentForPortal`, so assignee colors still work if Agent.email was out of sync.
 */
export async function loadStaffAssignmentColorsForAgents(
  agents: Iterable<AgentColorIdentity>,
): Promise<Map<string, string | null>> {
  const list = [...agents]
    .map((a) => ({
      emailKey: (a.email ?? "").trim().toLowerCase(),
      nameTrim: (a.name ?? "").trim(),
    }))
    .filter((a) => a.emailKey.length > 0 || a.nameTrim.length > 0);

  if (list.length === 0) return new Map();

  const uniqueEmails = [...new Set(list.map((a) => a.emailKey).filter(Boolean))];
  const emailToName = new Map<string, string>();
  for (const a of list) {
    if (a.emailKey && !emailToName.has(a.emailKey)) {
      emailToName.set(a.emailKey, a.nameTrim);
    }
  }

  const emailRows = await queryPortalColorsByEmails(uniqueEmails);
  const byEmail = new Map(emailRows.map((r) => [r.e, r]));

  const needsNameFallback =
    uniqueEmails.some((ek) => !byEmail.has(ek)) ||
    list.some((a) => !a.emailKey && a.nameTrim);

  const nameToColor = needsNameFallback
    ? await loadStaffPortalColorsByNormalizedName()
    : new Map<string, string | null>();

  const out = new Map<string, string | null>();
  for (const a of list) {
    if (a.emailKey) {
      if (out.has(a.emailKey)) continue;
      const hit = byEmail.get(a.emailKey);
      if (hit) {
        out.set(a.emailKey, isStaffPortalRole(hit.r) ? hit.c : null);
      } else if (a.nameTrim) {
        const nk = normalizePersonName(a.nameTrim);
        out.set(a.emailKey, (nk && nameToColor.get(nk)) ?? null);
      } else {
        out.set(a.emailKey, null);
      }
      continue;
    }
    // Name-only identity (no agent email) — key by normalized name for callers that look up that way.
    const nk = normalizePersonName(a.nameTrim);
    if (nk && !out.has(nk)) {
      out.set(nk, nameToColor.get(nk) ?? null);
    }
  }

  // Ensure every requested email key exists (including those with no color).
  for (const emailKey of uniqueEmails) {
    if (!out.has(emailKey)) out.set(emailKey, null);
  }

  return out;
}

/** @deprecated Prefer {@link loadStaffAssignmentColorsForAgents} with `{ email, name }` when the name is available. */
export async function loadStaffAssignmentColorsForAgentEmails(
  emails: Iterable<string | null | undefined>,
): Promise<Map<string, string | null>> {
  return loadStaffAssignmentColorsForAgents([...emails].map((email) => ({ email })));
}
