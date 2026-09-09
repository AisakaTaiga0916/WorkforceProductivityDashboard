import { prisma } from "@/lib/prisma";

async function main() {
  const result = await prisma.ticketActivity.updateMany({
    where: {
      summary: "Requesting company",
      ticket: { ticketNumber: "REQ-2026-00264" },
    },
    data: { detail: "MCHISI LPG" },
  });
  console.log("updated", result.count);

  const rows = await prisma.ticketActivity.findMany({
    where: {
      summary: "Requesting company",
      ticket: { ticketNumber: "REQ-2026-00264" },
    },
    select: { id: true, detail: true },
  });
  console.log(rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
