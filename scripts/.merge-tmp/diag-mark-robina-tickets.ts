import { prismaPrimary as prisma } from "../../src/lib/prisma";

async function main() {
  const agc = "3fe47d9d-b558-42ad-8cee-d84752f883b1";
  const neo = "cmth0m6as000n57c9e9qplrzr";
  const statuses = ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"] as const;

  const [allUn, agcUn, agcUnAnySection, neoUn, agcNullSection, sample, bySection] =
    await Promise.all([
      prisma.ticket.count({
        where: { assignedAgentId: null, status: { in: [...statuses] } },
      }),
      prisma.ticket.count({
        where: { assignedAgentId: null, teamId: agc, status: { in: [...statuses] } },
      }),
      prisma.ticket.count({
        where: {
          assignedAgentId: null,
          teamId: agc,
          status: { in: [...statuses] },
          orgChartSectionId: { not: null },
        },
      }),
      prisma.ticket.count({
        where: {
          assignedAgentId: null,
          teamId: agc,
          orgChartSectionId: neo,
          status: { in: [...statuses] },
        },
      }),
      prisma.ticket.count({
        where: {
          assignedAgentId: null,
          teamId: agc,
          orgChartSectionId: null,
          status: { in: [...statuses] },
        },
      }),
      prisma.ticket.findMany({
        where: { assignedAgentId: null, status: { in: [...statuses] } },
        take: 20,
        orderBy: { updatedAt: "desc" },
        select: {
          ticketNumber: true,
          teamId: true,
          orgChartSectionId: true,
          requestType: true,
          title: true,
          status: true,
        },
      }),
      prisma.ticket.groupBy({
        by: ["orgChartSectionId"],
        where: { assignedAgentId: null, teamId: agc, status: { in: [...statuses] } },
        _count: true,
      }),
    ]);

  const sectionIds = [
    ...new Set(
      [...sample.map((t) => t.orgChartSectionId), ...bySection.map((r) => r.orgChartSectionId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  const teamIds = [...new Set(sample.map((t) => t.teamId).filter((id): id is string => Boolean(id)))];
  const [teams, sections, neoHead] = await Promise.all([
    teamIds.length
      ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [],
    sectionIds.length
      ? prisma.orgChartSection.findMany({
          where: { id: { in: sectionIds } },
          select: { id: true, name: true, headNodeId: true },
        })
      : [],
    prisma.orgChartSection.findUnique({
      where: { id: neo },
      select: {
        id: true,
        name: true,
        headNodeId: true,
        headNode: { select: { mergedSourceUserId: true, personName: true } },
      },
    }),
  ]);
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const secMap = Object.fromEntries(sections.map((s) => [s.id, s.name]));

  console.log(
    JSON.stringify(
      {
        counts: { allUn, agcUn, agcUnAnySection, neoUn, agcNullSection },
        agcBySection: bySection.map((r) => ({
          section: r.orgChartSectionId ? secMap[r.orgChartSectionId] ?? r.orgChartSectionId : null,
          count: r._count,
        })),
        neoHead,
        sample: sample.map((t) => ({
          n: t.ticketNumber,
          type: t.requestType,
          status: t.status,
          team: t.teamId ? teamMap[t.teamId] ?? t.teamId : null,
          section: t.orgChartSectionId ? secMap[t.orgChartSectionId] ?? t.orgChartSectionId : null,
        })),
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
