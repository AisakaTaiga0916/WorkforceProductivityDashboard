import { prisma } from "../../src/lib/prisma";
import { logActivity } from "../../src/lib/ticket-actions";

const numbers = [
  "REQ-2026-00003",
  "REQ-2026-00005",
  "TKT-2026-00437",
  "TKT-2026-00438",
  "TKT-2026-00439",
  "REQ-2026-00010",
];

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: { ticketNumber: { in: numbers } },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      closedAt: true,
      resolvedAt: true,
      feedback: { select: { csat: true } },
    },
  });

  const found = new Set(tickets.map((t) => t.ticketNumber));
  const missing = numbers.filter((n) => !found.has(n));
  if (missing.length) {
    console.log("MISSING:", missing);
  }

  const now = new Date();
  const results = [];

  for (const t of tickets) {
    await prisma.ticketFeedback.upsert({
      where: { ticketId: t.id },
      create: { ticketId: t.id, csat: 5, comment: null },
      update: { csat: 5 },
    });

    const updated = await prisma.ticket.update({
      where: { id: t.id },
      data: {
        status: "CLOSED",
        closedAt: t.closedAt ?? now,
        resolvedAt: t.resolvedAt ?? now,
      },
      select: { ticketNumber: true, status: true, closedAt: true, resolvedAt: true },
    });

    await logActivity(
      t.id,
      "SYSTEM",
      "Status → CLOSED",
      "Closed with 5-star rating (admin/ops bulk close).",
    );

    results.push({
      ticketNumber: updated.ticketNumber,
      before: { status: t.status, csat: t.feedback?.csat ?? null },
      after: { status: updated.status, csat: 5, closedAt: updated.closedAt },
    });
  }

  console.log(JSON.stringify({ closed: results.length, results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
