import { prisma } from "../../src/lib/prisma";
import { loadAgentIdsForCompanyTeam, resolveAgentDesignatedCompanyId } from "../../src/lib/staff-company-scope";
import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { isPersonnelGuardPortalRole, normalizePortalRole } from "../../src/lib/staff-role";

async function main() {
  const team = await prisma.team.findUnique({
    where: { id: "3fe47d9d-b558-42ad-8cee-d84752f883b1" },
    select: { id: true, name: true },
  });
  console.log("orderCompanyTeam", team);

  const guards = await prisma.portalAccount.findMany({
    where: {
      OR: [
        { role: { equals: "Personnel-Guard", mode: "insensitive" } },
        { role: { contains: "guard", mode: "insensitive" } },
        { role: { contains: "personnel_guard", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, mergedSourceUserId: true },
    take: 30,
  });
  console.log(
    "guardPortals",
    guards.map((g) => ({
      name: g.name,
      email: g.email,
      role: g.role,
      normalized: normalizePortalRole(g.role),
      isGuard: isPersonnelGuardPortalRole(g.role),
    })),
  );

  for (const g of guards.slice(0, 8)) {
    const agent = await prisma.agent.findFirst({
      where: { email: { equals: g.email, mode: "insensitive" } },
      select: { id: true, name: true, email: true, teamId: true },
    });
    if (!agent) {
      console.log({ email: g.email, agent: null });
      continue;
    }
    const companyTeamId = await resolveAgentDesignatedCompanyId(agent.id);
    const visible = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: agent.id,
      gatePassOnly: true,
    });
    const visibleAll = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: agent.id,
      gatePassOnly: false,
    });
    console.log(
      JSON.stringify(
        {
          guard: g.name,
          email: g.email,
          agentId: agent.id,
          companyTeamId,
          companyMatch: companyTeamId === team?.id,
          visibleGatePassOnly: visible.map((o) => ({
            id: o.id,
            status: o.status,
            gpi: o.gatePassIncluded,
            title: o.orderRequest,
            company: o.companyTeamId,
          })),
          visibleAllApproved: visibleAll
            .filter((o) => o.status === "APPROVED")
            .map((o) => ({
              id: o.id,
              gpi: o.gatePassIncluded,
              title: o.orderRequest,
              company: o.companyTeamId,
            })),
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
