import { prismaPrimary, prismaAuth } from "../../src/lib/prisma";

async function main() {
  const agents = await prismaPrimary.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Malubay", mode: "insensitive" } },
        { name: { contains: "Reginald", mode: "insensitive" } },
        { email: { contains: "malubay", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, teamId: true, team: { select: { name: true } } },
  });

  const portals = await prismaPrimary.portalAccount.findMany({
    where: {
      OR: [
        { name: { contains: "Malubay", mode: "insensitive" } },
        { name: { contains: "Reginald", mode: "insensitive" } },
        { email: { contains: "malubay", mode: "insensitive" } },
        { username: { contains: "reginald", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      role: true,
      mergedSourceUserId: true,
      authUserId: true,
      accountStatus: true,
      staffDesignatedCompanyId: true,
      staffDesignatedCompany: { select: { name: true } },
    },
  });

  const agentIds = agents.map((a) => a.id);
  const emails = [
    ...agents.map((a) => a.email.toLowerCase()),
    ...portals.map((p) => p.email.toLowerCase()),
  ];

  const recentClosed = await prismaPrimary.ticket.findMany({
    where: {
      OR: [
        { assignedAgentId: { in: agentIds } },
        { closedAt: { not: null } },
      ],
      AND: [
        {
          OR: [
            { assignedAgentId: { in: agentIds } },
            { contactEmail: { in: emails, mode: "insensitive" } },
            { requestorEmail: { in: emails, mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: { closedAt: "desc" },
    take: 30,
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      requestType: true,
      assignedAgentId: true,
      closedAt: true,
      createdAt: true,
      contactName: true,
      contactEmail: true,
      requestorEmail: true,
    },
  });

  // tickets assigned to malubay agents
  const assignedTickets = await prismaPrimary.ticket.findMany({
    where: { assignedAgentId: { in: agentIds } },
    orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }],
    take: 40,
    select: {
      ticketNumber: true,
      title: true,
      status: true,
      requestType: true,
      assignedAgentId: true,
      closedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  const openAssigned = await prismaPrimary.ticket.groupBy({
    by: ["status"],
    where: { assignedAgentId: { in: agentIds } },
    _count: true,
  });

  // KPI contributor mentions
  const snaps = await prismaPrimary.$queryRaw<
    Array<{
      period_key: string;
      frequency: string;
      percent: number;
      total: number;
      done: number;
      kpi_title: string;
      main_task: string | null;
      contributor_progress: unknown;
      captured_at: Date;
    }>
  >`
    SELECT s.period_key, s.frequency::text AS frequency, s.percent, s.total, s.done,
           km.title AS kpi_title, km.main_task, s.contributor_progress, s.captured_at
    FROM kpi_maintenance_period_snapshots s
    JOIN kpi_maintenance km ON km.id = s.kpi_maintenance_id
    WHERE s.contributor_progress::text ILIKE '%Malubay%'
       OR s.contributor_progress::text ILIKE '%Reginald%'
       OR km.assigned_agent_id = ANY(${agentIds})
    ORDER BY s.captured_at DESC
    LIMIT 20
  `;

  console.log(
    JSON.stringify(
      {
        agents,
        portals,
        openAssigned,
        assignedTicketsSample: assignedTickets.slice(0, 15),
        closedAssigned: assignedTickets.filter((t) => t.closedAt).slice(0, 10),
        recentClosedRelated: recentClosed.slice(0, 10),
        kpiSnaps: snaps.map((s) => ({
          ...s,
          captured_at: s.captured_at,
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
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
  });
