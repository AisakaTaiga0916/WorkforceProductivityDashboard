import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  PrismaClient as PrismaClientPrimary,
} from "@prisma/client/primary";

/** Keep in sync with `src/lib/department-roster.ts` */
const DEPARTMENT_ROSTER = ["ACI", "HR", "Gen. Services", "AUDIT", "IT"] as const;

const prisma = new PrismaClientPrimary();

async function main() {
  // Clean primary (PostgreSQL) tables before reseeding
  await prisma.escalationTrigger.deleteMany();
  await prisma.slaPolicy.deleteMany();
  await prisma.ticketFeedback.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.ticketActivity.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.company.deleteMany();

  const policies: {
    priority: TicketPriority;
    firstResponseHours: number;
    resolutionHours: number;
  }[] = [
    { priority: "UNSET", firstResponseHours: 24, resolutionHours: 72 },
    { priority: "LOW", firstResponseHours: 24, resolutionHours: 72 },
    { priority: "MEDIUM", firstResponseHours: 8, resolutionHours: 48 },
    { priority: "HIGH", firstResponseHours: 2, resolutionHours: 24 },
    { priority: "URGENT", firstResponseHours: 1, resolutionHours: 4 },
  ];

  for (const p of policies) {
    await prisma.slaPolicy.create({ data: p });
  }

  for (const p of policies) {
    await prisma.escalationTrigger.create({
      data: {
        priority: p.priority,
        enabled: p.priority === "URGENT",
        notifyAdmin: p.priority === "URGENT",
      },
    });
  }

  const teamDescriptions: Record<(typeof DEPARTMENT_ROSTER)[number], string> = {
    ACI: "Accounting, compliance, and internal controls intake",
    HR: "People operations, benefits, and workplace matters",
    "Gen. Services": "Facilities, logistics, and general corporate services",
    AUDIT: "Internal audit requests and evidence coordination",
    IT: "Infrastructure, access, applications, and service desk",
  };

  for (const name of DEPARTMENT_ROSTER) {
    await prisma.company.create({
      data: {
        name,
        description: teamDescriptions[name],
      },
    });
  }

  const teams = await prisma.company.findMany();
  const team = (n: string) => teams.find((t) => t.name === n) ?? teams[0];

  const it = team("IT");
  const hr = team("HR");
  const aci = team("ACI");
  const audit = team("AUDIT");
  const genServices = team("Gen. Services");

  const agentSeed = await Promise.all([
    prisma.agent.create({
      data: { name: "John Laurence Magsadia", email: "john.magsadia@stoicops.local", teamId: it.id },
    }),
    prisma.agent.create({
      data: { name: "Kurt Jerelle Minoza", email: "kurt.minoza@stoicops.local", teamId: it.id },
    }),
    prisma.agent.create({
      data: { name: "Reginald Malubay", email: "reginald.malubay@stoicops.local", teamId: audit.id },
    }),
    prisma.agent.create({
      data: { name: "Zyrah Faith Gascon", email: "zyrah.gascon@stoicops.local", teamId: hr.id },
    }),
    prisma.agent.create({
      data: { name: "Brilian Galon", email: "brilian.galon@stoicops.local", teamId: it.id },
    }),
    prisma.agent.create({
      data: { name: "Edmund Magbanua", email: "edmund.magbanua@stoicops.local", teamId: aci.id },
    }),
    prisma.agent.create({
      data: { name: "Mark Anthony Robina", email: "mark.robina@stoicops.local", teamId: genServices.id },
    }),
    prisma.agent.create({
      data: { name: "Neziah Bernabe", email: "neziah.bernabe@stoicops.local", teamId: hr.id },
    }),
  ]);

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const sampleTickets: Array<{
    ticketNumber: string;
    title: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    teamId: string;
    assignedAgentId: string | null;
    contactName: string;
    contactEmail: string;
    createdOffsetHrs: number;
    updatedOffsetHrs: number;
  }> = [
    {
      ticketNumber: "REQ-2026-00001",
      title: "Mouse isn't working/cursor isn't appearing",
      description:
        "USB mouse intermittently disconnects from workstation.\nDepartment/Business Unit: IT Operations",
      category: "IT",
      priority: "LOW",
      status: "IN_PROGRESS",
      teamId: it.id,
      assignedAgentId: agentSeed[0].id,
      contactName: "Hardware Lab",
      contactEmail: "lab@stoicops.local",
      createdOffsetHrs: 39,
      updatedOffsetHrs: 1,
    },
    {
      ticketNumber: "REQ-2026-00002",
      title: "VPN profile not loading for remote users",
      description:
        "New hires cannot retrieve VPN profile from endpoint manager.\nDepartment/Business Unit: Remote Workforce",
      category: "IT",
      priority: "HIGH",
      status: "OPEN",
      teamId: audit.id,
      assignedAgentId: null,
      contactName: "Remote Workforce",
      contactEmail: "remote@stoicops.local",
      createdOffsetHrs: 9,
      updatedOffsetHrs: 2,
    },
    {
      ticketNumber: "REQ-2026-00003",
      title: "Payroll exception for night shift differential",
      description:
        "Shift differential not reflected for April payroll cycle.\nDepartment/Business Unit: Payroll",
      category: "FINANCE",
      priority: "MEDIUM",
      status: "RESOLVED",
      teamId: aci.id,
      assignedAgentId: agentSeed[5].id,
      contactName: "Payroll Team",
      contactEmail: "payroll@stoicops.local",
      createdOffsetHrs: 28,
      updatedOffsetHrs: 6,
    },
    {
      ticketNumber: "REQ-2026-00004",
      title: "Benefits enrollment window extension",
      description:
        "Requesting extension for dependent enrollment.\nDepartment/Business Unit: People Operations",
      category: "HR",
      priority: "LOW",
      status: "PENDING_INFO",
      teamId: hr.id,
      assignedAgentId: agentSeed[3].id,
      contactName: "People Operations",
      contactEmail: "people@stoicops.local",
      createdOffsetHrs: 22,
      updatedOffsetHrs: 3,
    },
    {
      ticketNumber: "REQ-2026-00005",
      title: "Database connection spikes from report jobs",
      description:
        "Scheduled reports causing brief latency on ticket API.\nDepartment/Business Unit: Data Platform",
      category: "IT",
      priority: "URGENT",
      status: "ESCALATED",
      teamId: audit.id,
      assignedAgentId: agentSeed[2].id,
      contactName: "Data Platform",
      contactEmail: "data@stoicops.local",
      createdOffsetHrs: 12,
      updatedOffsetHrs: 2,
    },
    {
      ticketNumber: "REQ-2026-00006",
      title: "Office access card reprogramming",
      description:
        "Badge reader not syncing for 4th floor.\nDepartment/Business Unit: Facilities",
      category: "OPERATIONS",
      priority: "MEDIUM",
      status: "CLOSED",
      teamId: genServices.id,
      assignedAgentId: agentSeed[6].id,
      contactName: "Facilities",
      contactEmail: "facilities@stoicops.local",
      createdOffsetHrs: 46,
      updatedOffsetHrs: 26,
    },
    {
      ticketNumber: "REQ-2026-00007",
      title: "Email relay blocked by SPF mismatch",
      description:
        "Outbound notifications failing for custom sender domain.\nDepartment/Business Unit: Communications",
      category: "IT",
      priority: "HIGH",
      status: "OPEN",
      teamId: it.id,
      assignedAgentId: null,
      contactName: "Communications",
      contactEmail: "comms@stoicops.local",
      createdOffsetHrs: 5,
      updatedOffsetHrs: 1,
    },
    {
      ticketNumber: "REQ-2026-00008",
      title: "Quarterly close checklist sign-off",
      description:
        "Currency columns misaligned in exported board deck.\nDepartment/Business Unit: Finance",
      category: "FINANCE",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      teamId: aci.id,
      assignedAgentId: agentSeed[5].id,
      contactName: "Executive Office",
      contactEmail: "exec@stoicops.local",
      createdOffsetHrs: 7,
      updatedOffsetHrs: 1,
    },
  ];

  for (const t of sampleTickets) {
    const createdAt = new Date(now - t.createdOffsetHrs * hour);
    const updatedAt = new Date(now - t.updatedOffsetHrs * hour);
    const firstResponseDueAt = new Date(createdAt.getTime() + 2 * hour);
    const resolutionDueAt = new Date(createdAt.getTime() + 24 * hour);
    const resolvedAt =
      t.status === "RESOLVED" || t.status === "CLOSED" ? new Date(updatedAt.getTime() - 30 * 60 * 1000) : null;
    const closedAt = t.status === "CLOSED" ? updatedAt : null;
    const firstResponseAt = t.status === "OPEN" ? null : new Date(createdAt.getTime() + 45 * 60 * 1000);

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: t.ticketNumber,
        title: t.title,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        contactName: t.contactName,
        contactEmail: t.contactEmail,
        teamId: t.teamId,
        assignedAgentId: t.assignedAgentId,
        firstResponseDueAt,
        resolutionDueAt,
        firstResponseAt,
        resolvedAt,
        closedAt,
        createdAt,
        updatedAt,
      },
    });

    await prisma.ticketActivity.createMany({
      data: [
        {
          ticketId: ticket.id,
          actor: "SYSTEM",
          summary: "Ticket created",
          detail: `Queued for ${teams.find((x) => x.id === t.teamId)?.name ?? "department"}.`,
          createdAt,
        },
        {
          ticketId: ticket.id,
          actor: t.assignedAgentId ? "AGENT" : "SYSTEM",
          summary: t.assignedAgentId ? "Assigned to agent" : "Awaiting assignment",
          detail: t.assignedAgentId
            ? `Assigned to ${agentSeed.find((a) => a.id === t.assignedAgentId)?.name ?? "agent"}.`
            : "Pending manual assignment.",
          createdAt: new Date(createdAt.getTime() + 20 * 60 * 1000),
        },
        {
          ticketId: ticket.id,
          actor: "AGENT",
          summary: "Latest status update",
          detail: `Current status: ${t.status.replaceAll("_", " ")}.`,
          createdAt: updatedAt,
        },
      ],
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
