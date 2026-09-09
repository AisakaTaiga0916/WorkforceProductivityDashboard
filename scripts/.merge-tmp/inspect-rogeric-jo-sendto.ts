import { prisma } from "@/lib/prisma";

async function main() {
  const nodes = await prisma.orgChartNode.findMany({
    where: {
      OR: [
        { personName: { contains: "Rogeric", mode: "insensitive" } },
        { personName: { contains: "Raza Reyes", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      personName: true,
      personRole: true,
      companyName: true,
      mergedSourceUserId: true,
      sectionId: true,
      section: {
        select: {
          id: true,
          name: true,
          parentId: true,
          parent: { select: { id: true, name: true } },
          companyTeam: { select: { id: true, name: true } },
        },
      },
      sectionMemberships: {
        select: {
          sectionId: true,
          section: { select: { id: true, name: true, parentId: true } },
        },
      },
    },
  });
  console.log("rogericNodes", JSON.stringify(nodes, null, 2));

  const jos = await prisma.ticket.findMany({
    where: { jobOrderApprovalMeta: { not: null } },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      orgChartSectionId: true,
      orgChartSection: { select: { id: true, name: true } },
      team: { select: { name: true } },
      createdAt: true,
    },
    orderBy: { ticketNumber: "asc" },
  });
  console.log(
    "allJOs",
    JSON.stringify(
      jos.map((j) => ({
        ticketNumber: j.ticketNumber,
        status: j.status,
        title: j.title,
        sendTo: j.orgChartSection?.name ?? null,
        sendToId: j.orgChartSectionId,
        company: j.team?.name ?? null,
        createdAt: j.createdAt,
      })),
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
