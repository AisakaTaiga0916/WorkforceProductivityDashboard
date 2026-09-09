import { prisma } from "@/lib/prisma";

async function main() {
  const t = await prisma.ticket.findUnique({
    where: { ticketNumber: "REQ-2026-00169" },
    include: {
      team: { select: { id: true, name: true } },
      assignedAgent: { select: { id: true, name: true, email: true } },
      requestorOrgChartSection: { select: { id: true, name: true } },
      orgChartSection: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) {
    console.log("NOT FOUND");
    return;
  }
  console.log(
    JSON.stringify(
      {
        id: t.id,
        ticketNumber: t.ticketNumber,
        requestType: t.requestType,
        status: t.status,
        title: t.title,
        team: t.team,
        assignedAgent: t.assignedAgent,
        requestorOrgChartSection: t.requestorOrgChartSection,
        orgChartSection: t.orgChartSection,
        paymentApprovalMeta: t.paymentApprovalMeta,
        activities: t.activities.map((a) => ({
          id: a.id,
          summary: a.summary,
          detail: a.detail,
        })),
      },
      null,
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
    await prisma.$disconnect();
  });
