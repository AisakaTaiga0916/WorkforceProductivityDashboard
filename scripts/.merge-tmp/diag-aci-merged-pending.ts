/**
 * Explain merged ACI ticket pending vs live Task Metrics for suspicious names.
 */
import { Prisma } from "@prisma/client/primary";
import { prisma } from "../../src/lib/prisma";
import { OPEN_PIPELINE_STATUSES } from "../../src/lib/active-request-statuses";
import { parsePaymentApprovalMeta } from "../../src/lib/request-for-payment-approval";

const NAMES = [
  "Riezel Cua Lelis",
  "Guerrero, Dianne Ross Plaza",
  "Queenie Ansit Palabrica",
  "Kimberly Pada Caliag",
  "Zeta Love Talatagod Valencia",
  "Alren Querequincia Namata",
  "Juan Miguel Go Uykimpang",
  "Manilyn Arcala Edquila",
  "Rogeric Raza Reyes",
  "Tanutan, Wyneth Maxine",
  "Arbole, Jojie Molde",
];

const PROCEDURAL = [
  "REQUEST_FOR_PAYMENT",
  "ITEM_REQUISITION_SLIP",
  "FUND_TRANSFER_REQUEST",
  "AUTHORITY_TO_CONDUCT_ACTIVITY",
] as const;

async function main() {
  const agents = await prisma.agent.findMany({
    where: {
      OR: NAMES.map((n) => ({
        name: { contains: n.split(",")[0].split(" ")[0], mode: "insensitive" as const },
      })),
    },
    select: { id: true, name: true },
  });
  const wanted = agents.filter((a) =>
    NAMES.some((n) => a.name.toLowerCase().includes(n.split(",")[0].toLowerCase().slice(0, 8))),
  );
  const byId = new Map(wanted.map((a) => [a.id, a.name]));

  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { assignedAgentId: { in: [...byId.keys()] } },
        { requestType: "REQUEST_FOR_PAYMENT", paymentApprovalMeta: { not: Prisma.DbNull } },
      ],
    },
    select: {
      ticketNumber: true,
      requestType: true,
      status: true,
      closedAt: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });

  const out: unknown[] = [];
  for (const [id, name] of byId) {
    const asAssigneePending = tickets.filter(
      (t) =>
        t.assignedAgentId === id &&
        OPEN_PIPELINE_STATUSES.includes(t.status as (typeof OPEN_PIPELINE_STATUSES)[number]),
    );
    const asAssigneePendingNonProc = asAssigneePending.filter(
      (t) => !(PROCEDURAL as readonly string[]).includes(t.requestType ?? ""),
    );
    const asAssigneePendingProc = asAssigneePending.filter((t) =>
      (PROCEDURAL as readonly string[]).includes(t.requestType ?? ""),
    );
    const rfpRoles: unknown[] = [];
    for (const t of tickets) {
      if (t.requestType !== "REQUEST_FOR_PAYMENT") continue;
      const meta = parsePaymentApprovalMeta(t.paymentApprovalMeta);
      if (!meta) continue;
      const hit =
        meta.approvedByAgentId === id ||
        meta.accountingAgentId === id ||
        meta.financeAgentId === id ||
        meta.notedByAgentId === id;
      if (!hit) continue;
      rfpRoles.push({
        ticket: t.ticketNumber,
        status: t.status,
        step: meta.proceduralStep,
        asApprovedBy: meta.approvedByAgentId === id,
        asBookkeeper: meta.accountingAgentId === id,
        asFinance: meta.financeAgentId === id,
        asNotedBy: meta.notedByAgentId === id,
        boardAssigneeIsSelf: t.assignedAgentId === id,
      });
    }
    out.push({
      name,
      id,
      assigneePendingAll: asAssigneePending.length,
      assigneePendingNonProcedural: asAssigneePendingNonProc.map((t) => ({
        ticket: t.ticketNumber,
        type: t.requestType,
        status: t.status,
      })),
      assigneePendingProcedural: asAssigneePendingProc.map((t) => ({
        ticket: t.ticketNumber,
        type: t.requestType,
        status: t.status,
      })),
      rfpRoleHits: rfpRoles,
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
