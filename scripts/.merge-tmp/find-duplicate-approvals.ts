import { prisma } from "@/lib/prisma";
import { parsePaymentApprovalMeta } from "@/lib/request-for-payment-approval";
import { parseJobOrderApprovalMeta } from "@/lib/job-order-approval";
import { parseItemRequisitionApprovalMeta } from "@/lib/item-requisition-approval";
import { parseFundTransferApprovalMeta } from "@/lib/fund-transfer-approval";
import { parseAcaApprovalMeta } from "@/lib/aca-approval";

type SeatHit = { seat: string; agentId: string };

function paymentSeats(meta: ReturnType<typeof parsePaymentApprovalMeta>): SeatHit[] {
  if (!meta) return [];
  const rows: SeatHit[] = [
    { seat: "Prepared By", agentId: meta.preparedByAgentId ?? "" },
    { seat: "Noted By", agentId: meta.notedByAgentId ?? "" },
    { seat: "Approved By", agentId: meta.approvedByAgentId ?? "" },
    { seat: "Prepared by Bookkeeper", agentId: meta.accountingAgentId ?? "" },
    { seat: "Approved By Accounting", agentId: meta.financeAgentId ?? "" },
  ];
  return rows.filter((r) => r.agentId.trim());
}

function jobOrderSeats(meta: ReturnType<typeof parseJobOrderApprovalMeta>): SeatHit[] {
  if (!meta) return [];
  const rows: SeatHit[] = [
    { seat: "Submitted By", agentId: meta.preparedByAgentId ?? "" },
    { seat: "Noted By", agentId: meta.notedByAgentId ?? "" },
    { seat: "Approved By (Send-to)", agentId: meta.approvedByAgentId ?? "" },
    { seat: "Approved By (final)", agentId: meta.approvedBy2AgentId ?? "" },
  ];
  return rows.filter((r) => r.agentId.trim());
}

function irsSeats(meta: ReturnType<typeof parseItemRequisitionApprovalMeta>): SeatHit[] {
  if (!meta) return [];
  const rows: SeatHit[] = [
    { seat: "Canvassed By", agentId: meta.canvassedByAgentId ?? "" },
    { seat: "Approved By", agentId: meta.approvedByAgentId ?? "" },
  ];
  return rows.filter((r) => r.agentId.trim());
}

function ftrSeats(meta: ReturnType<typeof parseFundTransferApprovalMeta>): SeatHit[] {
  if (!meta) return [];
  const rows: SeatHit[] = [
    { seat: "Prepared By", agentId: meta.preparedByAgentId ?? "" },
    { seat: "Recommending Approval", agentId: meta.recommendingApprovalAgentId ?? "" },
    { seat: "Approved By", agentId: meta.approvedByAgentId ?? "" },
  ];
  return rows.filter((r) => r.agentId.trim());
}

function acaSeats(meta: ReturnType<typeof parseAcaApprovalMeta>): SeatHit[] {
  if (!meta) return [];
  return meta.levels
    .filter((l) => Boolean(l.agentId?.trim()))
    .map((l) => ({
      seat: l.label?.trim() || l.roleCode || l.key,
      agentId: l.agentId!.trim(),
    }));
}

function findDuplicateSeats(seats: SeatHit[]): Array<{ agentId: string; seats: string[] }> {
  const byAgent = new Map<string, string[]>();
  for (const s of seats) {
    const list = byAgent.get(s.agentId) ?? [];
    list.push(s.seat);
    byAgent.set(s.agentId, list);
  }
  return [...byAgent.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([agentId, names]) => ({ agentId, seats: names }));
}

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED", "FOR_CONFIRMATION"] },
      OR: [
        { paymentApprovalMeta: { not: null } },
        { jobOrderApprovalMeta: { not: null } },
        { itemRequisitionApprovalMeta: { not: null } },
        { fundTransferApprovalMeta: { not: null } },
        { acaApprovalMeta: { not: null } },
      ],
    },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      paymentApprovalMeta: true,
      jobOrderApprovalMeta: true,
      itemRequisitionApprovalMeta: true,
      fundTransferApprovalMeta: true,
      acaApprovalMeta: true,
    },
    orderBy: { ticketNumber: "asc" },
  });

  const hits: Array<{
    ticketNumber: string;
    status: string;
    title: string;
    type: string;
    duplicates: Array<{ agentId: string; name: string; seats: string[] }>;
  }> = [];

  const agentIds = new Set<string>();

  for (const t of tickets) {
    const candidates: Array<{ type: string; seats: SeatHit[] }> = [
      { type: "REQUEST FOR PAYMENT", seats: paymentSeats(parsePaymentApprovalMeta(t.paymentApprovalMeta)) },
      { type: "JOB ORDER", seats: jobOrderSeats(parseJobOrderApprovalMeta(t.jobOrderApprovalMeta)) },
      {
        type: "ITEM REQUISITION",
        seats: irsSeats(parseItemRequisitionApprovalMeta(t.itemRequisitionApprovalMeta)),
      },
      {
        type: "FUND TRANSFER",
        seats: ftrSeats(parseFundTransferApprovalMeta(t.fundTransferApprovalMeta)),
      },
      { type: "ACA", seats: acaSeats(parseAcaApprovalMeta(t.acaApprovalMeta)) },
    ];

    for (const c of candidates) {
      const dups = findDuplicateSeats(c.seats);
      if (dups.length === 0) continue;
      for (const d of dups) agentIds.add(d.agentId);
      hits.push({
        ticketNumber: t.ticketNumber,
        status: t.status,
        title: t.title,
        type: c.type,
        duplicates: dups.map((d) => ({ ...d, name: d.agentId })),
      });
    }
  }

  const agents = agentIds.size
    ? await prisma.agent.findMany({
        where: { id: { in: [...agentIds] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  for (const h of hits) {
    h.duplicates = h.duplicates.map((d) => ({
      ...d,
      name: nameById.get(d.agentId) ?? d.agentId,
    }));
  }

  console.log(
    JSON.stringify(
      {
        scannedOpenLikeTickets: tickets.length,
        duplicateApprovalCount: hits.length,
        rows: hits,
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
