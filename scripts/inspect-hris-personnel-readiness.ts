/**
 * Snapshot: how many HRIS-linked portals can appear on Personnel today.
 */
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";
import { isStaffPortalRole } from "../src/lib/staff-role";

async function main() {
  const linked = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null } },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      role: true,
      accountStatus: true,
      staffDesignatedCompanyId: true,
      mergedSourceUserId: true,
    },
  });

  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, email: true, name: true, teamId: true },
  });

  const unlinkedActive = await prismaPrimary.portalAccount.findMany({
    where: {
      mergedSourceUserId: null,
      accountStatus: "ACTIVE",
      role: { in: ["Admin", "Personnel", "SuperAdmin"] },
    },
    select: { id: true, email: true, name: true, username: true, role: true },
  });

  const linkedStaff = linked.filter((p) => isStaffPortalRole(p.role));
  const withCompany = linkedStaff.filter((p) => p.staffDesignatedCompanyId);
  const withoutCompany = linkedStaff.filter((p) => !p.staffDesignatedCompanyId);

  let withAgent = 0;
  for (const p of withCompany) {
    const hit = agents.some(
      (a) => a.email.trim().toLowerCase() === p.email.trim().toLowerCase(),
    );
    if (hit) withAgent++;
  }

  const merged = await prismaSecondary.$queryRaw<
    { company_name: string | null; c: bigint }[]
  >`
    SELECT company_name, COUNT(*) AS c
    FROM merged_users WHERE is_active = 1
    GROUP BY company_name ORDER BY c DESC
  `;

  const teams = await prismaPrimary.team.findMany({ select: { id: true, name: true } });

  console.log(
    JSON.stringify(
      {
        linkedTotal: linked.length,
        linkedStaff: linkedStaff.length,
        linkedStaffWithCompany: withCompany.length,
        linkedStaffWithoutCompany: withoutCompany.length,
        withCompanyAndAgent: withAgent,
        unlinkedActiveStaff: unlinkedActive.length,
        unlinkedSamples: unlinkedActive.slice(0, 10),
        withoutCompanySamples: withoutCompany.slice(0, 10).map((p) => ({
          username: p.username,
          email: p.email,
          role: p.role,
        })),
        mergedCompanies: merged.map((m) => ({
          company: m.company_name,
          count: Number(m.c),
        })),
        teams: teams.map((t) => t.name),
      },
      null,
      2,
    ),
  );
}

main().finally(async () => {
  await prismaPrimary.$disconnect();
  await prismaSecondary.$disconnect();
});
