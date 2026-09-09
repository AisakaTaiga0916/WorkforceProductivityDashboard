import { prisma } from "@/lib/prisma";
import {
  parsePaymentApprovalMeta,
  currentPaymentStepBoardAssigneeId,
} from "@/lib/request-for-payment-approval";
import {
  parseJobOrderApprovalMeta,
  currentJobOrderStepBoardAssigneeId,
} from "@/lib/job-order-approval";

type Fix = {
  ticketNumber: string;
  type: "RFP" | "JO";
  changes: string[];
};

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED", "FOR_CONFIRMATION"] },
      OR: [{ paymentApprovalMeta: { not: null } }, { jobOrderApprovalMeta: { not: null } }],
    },
    select: {
      id: true,
      ticketNumber: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      jobOrderApprovalMeta: true,
    },
    orderBy: { ticketNumber: "asc" },
  });

  const fixes: Fix[] = [];

  for (const t of tickets) {
    const payment = parsePaymentApprovalMeta(t.paymentApprovalMeta);
    if (payment) {
      const changes: string[] = [];
      let next = { ...payment };
      const bookkeeper = next.accountingAgentId?.trim() || null;
      if (
        bookkeeper &&
        (bookkeeper === next.approvedByAgentId || bookkeeper === next.notedByAgentId)
      ) {
        const matched =
          bookkeeper === next.approvedByAgentId ? "Approved By" : "Noted By";
        next = { ...next, accountingAgentId: null };
        changes.push(`Cleared Prepared by Bookkeeper (was same as ${matched})`);
      }

      if (changes.length > 0) {
        const nextAssignee = currentPaymentStepBoardAssigneeId(next);
        await prisma.ticket.update({
          where: { id: t.id },
          data: {
            paymentApprovalMeta: next,
            ...(nextAssignee && nextAssignee !== t.assignedAgentId
              ? { assignedAgentId: nextAssignee }
              : {}),
          },
        });
        await prisma.ticketActivity.create({
          data: {
            ticketId: t.id,
            actor: "SYSTEM",
            summary: "Duplicate approval seats cleared",
            detail: changes.join("; "),
          },
        });
        fixes.push({ ticketNumber: t.ticketNumber, type: "RFP", changes });
      }
    }

    const jo = parseJobOrderApprovalMeta(t.jobOrderApprovalMeta);
    if (jo) {
      const changes: string[] = [];
      let next = { ...jo };
      const submitted = next.preparedByAgentId?.trim() || null;
      const noted = next.notedByAgentId?.trim() || null;
      if (submitted && noted && submitted === noted) {
        next = { ...next, notedByAgentId: null };
        changes.push("Cleared Noted By (was same as Submitted By)");
      }

      // Also clear final Approved By if it duplicates an earlier seat.
      const final = next.approvedBy2AgentId?.trim() || null;
      if (
        final &&
        (final === next.preparedByAgentId ||
          final === next.notedByAgentId ||
          final === next.approvedByAgentId)
      ) {
        const matched =
          final === next.preparedByAgentId
            ? "Submitted By"
            : final === next.notedByAgentId
              ? "Noted By"
              : "Approved By (Send-to)";
        next = { ...next, approvedBy2AgentId: null };
        changes.push(`Cleared final Approved By (was same as ${matched})`);
      }

      const sendTo = next.approvedByAgentId?.trim() || null;
      if (
        sendTo &&
        (sendTo === next.preparedByAgentId || sendTo === next.notedByAgentId)
      ) {
        const matched =
          sendTo === next.preparedByAgentId ? "Submitted By" : "Noted By";
        next = { ...next, approvedByAgentId: null };
        changes.push(`Cleared Approved By (Send-to) (was same as ${matched})`);
      }

      if (changes.length > 0) {
        const nextAssignee = currentJobOrderStepBoardAssigneeId(next);
        await prisma.ticket.update({
          where: { id: t.id },
          data: {
            jobOrderApprovalMeta: next,
            // If current board person was the cleared Noted By seat, move/clear board.
            assignedAgentId: nextAssignee,
          },
        });
        await prisma.ticketActivity.create({
          data: {
            ticketId: t.id,
            actor: "SYSTEM",
            summary: "Duplicate approval seats cleared",
            detail: changes.join("; "),
          },
        });
        fixes.push({ ticketNumber: t.ticketNumber, type: "JO", changes });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        fixedCount: fixes.length,
        rfp: fixes.filter((f) => f.type === "RFP").length,
        jo: fixes.filter((f) => f.type === "JO").length,
        fixes,
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
