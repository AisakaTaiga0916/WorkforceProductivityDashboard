import { prisma } from "@/modules/platform/db/prisma";

/** Queue for customer requests that do not match a known roster SBU name. */
export const OUTSIDE_COMPANY_TEAM_NAME = "OUTSIDE COMPANY" as const;

export async function ensureOutsideCompanyTeam(): Promise<{ id: string; name: string }> {
  const existing = await prisma.team.findFirst({
    where: { name: OUTSIDE_COMPANY_TEAM_NAME },
    select: { id: true, name: true },
  });
  if (existing) return existing;
  const created = await prisma.team.create({
    data: { name: OUTSIDE_COMPANY_TEAM_NAME },
    select: { id: true, name: true },
  });
  return created;
}
