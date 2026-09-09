import { prisma } from "@/lib/prisma";

const ROGERIC_SECTION_ID = "cmth0lmbu000l57c9prlu07ho";
const ROGERIC_SECTION_NAME =
  "ADMIN & PROPERTY SERVICES GENERAL SERVICES & MOTOR POOL SERV";

async function main() {
  const section = await prisma.orgChartSection.findUnique({
    where: { id: ROGERIC_SECTION_ID },
    select: { id: true, name: true },
  });
  if (!section) throw new Error(`Section ${ROGERIC_SECTION_ID} not found`);

  const targets = await prisma.ticket.findMany({
    where: {
      jobOrderApprovalMeta: { not: null },
      orgChartSectionId: null,
    },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
    },
    orderBy: { ticketNumber: "asc" },
  });

  if (targets.length === 0) {
    console.log(JSON.stringify({ updated: 0, message: "No legacy JOs missing send-to" }));
    return;
  }

  const result = await prisma.ticket.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { orgChartSectionId: ROGERIC_SECTION_ID },
  });

  await prisma.ticketActivity.createMany({
    data: targets.map((t) => ({
      ticketId: t.id,
      actor: "SYSTEM" as const,
      summary: "Send request to (department) updated",
      detail: `Set to ${ROGERIC_SECTION_NAME} (Rogeric Raza Reyes org-chart section)`,
    })),
  });

  console.log(
    JSON.stringify(
      {
        section: section.name,
        updated: result.count,
        tickets: targets.map((t) => t.ticketNumber),
      },
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
