/**
 * Diagnose why specific agents have RFP Accounting KPI when they may only be Approvers.
 * Run: npx tsx scripts/.merge-tmp/diag-rfp-approver-credit.ts
 */
import { Prisma } from "@prisma/client/primary";
import { prisma } from "../../src/lib/prisma";
import { parsePaymentApprovalMeta } from "../../src/lib/request-for-payment-approval";

async function main() {
  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Reyes", mode: "insensitive" } },
        { name: { contains: "Lelis", mode: "insensitive" } },
        { name: { contains: "Isabel", mode: "insensitive" } },
        { name: { contains: "Riezel", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });
  console.log("matchedAgents", agents);
  const targetIds = new Set(agents.map((a) => a.id));

  const tickets = await prisma.ticket.findMany({
    where: {
      requestType: "REQUEST_FOR_PAYMENT",
      paymentApprovalMeta: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      closedAt: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  });

  const hits: unknown[] = [];
  for (const t of tickets) {
    const meta = parsePaymentApprovalMeta(t.paymentApprovalMeta);
    if (!meta) continue;
    const roles = {
      approvedBy: meta.approvedByAgentId,
      accounting: meta.accountingAgentId,
      finance: meta.financeAgentId,
      preparedBy: meta.preparedByAgentId,
      boardAssignee: t.assignedAgentId,
    };
    const involved =
      (roles.approvedBy && targetIds.has(roles.approvedBy)) ||
      (roles.accounting && targetIds.has(roles.accounting)) ||
      (roles.finance && targetIds.has(roles.finance)) ||
      (roles.preparedBy && targetIds.has(roles.preparedBy)) ||
      (roles.boardAssignee && targetIds.has(roles.boardAssignee));
    if (!involved) continue;

    const pendingAcctId = meta.accountingAgentId ?? t.assignedAgentId;
    const pendingFinId = meta.financeAgentId ?? t.assignedAgentId;
    hits.push({
      ticket: t.ticketNumber,
      status: t.status,
      closedAt: t.closedAt,
      step: meta.proceduralStep,
      roles: {
        approvedBy: roles.approvedBy,
        accountingBookkeeper: roles.accounting,
        financeApprovedByAccounting: roles.finance,
        preparedBy: roles.preparedBy,
        boardAssignee: t.assignedAgent?.name ?? roles.boardAssignee,
      },
      roleNames: await resolveNames({
        approvedBy: roles.approvedBy,
        accounting: roles.accounting,
        finance: roles.finance,
        preparedBy: roles.preparedBy,
      }),
      wouldCreditPendingAccounting: meta.proceduralStep === "APPROVED_BY_ACCOUNTING" ? pendingAcctId : null,
      wouldCreditPendingFinance: meta.proceduralStep === "APPROVED_BY_FINANCE" ? pendingFinId : null,
      fallbackUsedForAccountingPending:
        meta.proceduralStep === "APPROVED_BY_ACCOUNTING" && !meta.accountingAgentId,
      targetHitAs: {
        approvedBy: roles.approvedBy && targetIds.has(roles.approvedBy),
        accounting: roles.accounting && targetIds.has(roles.accounting),
        finance: roles.finance && targetIds.has(roles.finance),
        preparedBy: roles.preparedBy && targetIds.has(roles.preparedBy),
        boardAssignee: roles.boardAssignee && targetIds.has(roles.boardAssignee),
      },
    });
  }

  console.log(JSON.stringify({ hitCount: hits.length, hits }, null, 2));
}

async function resolveNames(ids: Record<string, string | null | undefined>) {
  const list = Object.values(ids).filter((id): id is string => Boolean(id));
  if (list.length === 0) return {};
  const agents = await prisma.agent.findMany({
    where: { id: { in: list } },
    select: { id: true, name: true },
  });
  const map = new Map(agents.map((a) => [a.id, a.name]));
  return Object.fromEntries(
    Object.entries(ids).map(([k, id]) => [k, id ? map.get(id) ?? id : null]),
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
