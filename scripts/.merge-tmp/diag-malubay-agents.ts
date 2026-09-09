import { prismaPrimary } from "../../src/lib/prisma";

const LEGACY = "cmrpyuvty000111lydrm8c8qk";
const HRIS = "cmrpr1c8u000xj1cin55odq2m";
const EXCLUDE = [
  "REQUEST_FOR_PAYMENT",
  "ITEM_REQUISITION_SLIP",
  "FUND_TRANSFER_REQUEST",
  "AUTHORITY_TO_CONDUCT_ACTIVITY",
] as const;

async function dump(label: string, id: string) {
  const closedWhere = {
    assignedAgentId: id,
    closedAt: { not: null },
    NOT: { requestType: { in: [...EXCLUDE] } },
  } as const;
  const pendingWhere = {
    assignedAgentId: id,
    status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO"] as const },
    NOT: { requestType: { in: [...EXCLUDE] } },
  } as const;

  const [closedCount, pendingCount, forConf, closed, pending, kpis] = await Promise.all([
    prismaPrimary.ticket.count({ where: closedWhere }),
    prismaPrimary.ticket.count({ where: pendingWhere }),
    prismaPrimary.ticket.count({ where: { assignedAgentId: id, status: "FOR_CONFIRMATION" } }),
    prismaPrimary.ticket.findMany({
      where: closedWhere,
      orderBy: { closedAt: "desc" },
      take: 5,
      select: {
        ticketNumber: true,
        title: true,
        requestType: true,
        closedAt: true,
        status: true,
      },
    }),
    prismaPrimary.ticket.findMany({
      where: pendingWhere,
      take: 5,
      select: { ticketNumber: true, title: true, requestType: true, status: true },
    }),
    prismaPrimary.kpiMaintenance.findMany({
      where: { assignedAgentId: id },
      select: { id: true, title: true, mainTask: true, frequency: true },
    }),
  ]);

  // Closures in Aug 2026 Manila (rough UTC window)
  const closedAug = await prismaPrimary.ticket.findMany({
    where: {
      ...closedWhere,
      closedAt: {
        gte: new Date("2026-07-31T16:00:00.000Z"),
        lt: new Date("2026-08-31T16:00:00.000Z"),
      },
    },
    orderBy: { closedAt: "desc" },
    select: {
      ticketNumber: true,
      title: true,
      requestType: true,
      closedAt: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        label,
        id,
        closedCount,
        pendingCount,
        forConf,
        closedAug2026: closedAug,
        closedSample: closed,
        pendingSample: pending,
        assignedKpis: kpis,
      },
      null,
      2,
    ),
  );
}

async function main() {
  await dump("legacy Reginald Malubay (card name)", LEGACY);
  await dump("HRIS Malubay, Reginald Araña", HRIS);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
