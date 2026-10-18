import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { sortByRosterOrder, rosterTeamNameFilter } from "@/lib/company-roster";
import { loadPersonnelAccountsPayload } from "@/lib/personnel-accounts-data";
import { prisma } from "@/modules/platform/db/prisma";

export async function GET() {
  const { session, unauthorized } = await requireRole(["Admin"]);
  if (unauthorized) return unauthorized;

  const [payload, assignableTeams] = await Promise.all([
    loadPersonnelAccountsPayload({
      role: session.user.role,
      email: session.user.email,
    }),
    prisma.team.findMany({
      where: rosterTeamNameFilter(),
      select: { id: true, name: true },
    }),
  ]);

  return NextResponse.json({
    personnel: payload.personnel,
    teams: payload.teams,
    assignableCompanies: sortByRosterOrder(assignableTeams),
    scopedCompanyTeamId: payload.scopedCompanyTeamId,
    scopedCompanyName: payload.scopedCompanyName,
    scopeUnavailable: payload.scopeUnavailable,
    viewerMode: payload.viewerMode,
  });
}
