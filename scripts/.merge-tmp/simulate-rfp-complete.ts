import { Prisma } from "@prisma/client/primary";
import { prisma } from "../../src/lib/prisma";
import {
  applyPaymentApprovalAssignees,
  completePaymentApprovalStep,
  parsePaymentApprovalMeta,
} from "../../src/lib/request-for-payment-approval";
import { savePaymentApprovalMeta } from "../../src/lib/payment-approval-db";

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const rows = await prisma.$queryRaw<
    Array<{ id: string; payment_approval_meta: unknown; assigned_agent_id: string | null }>
  >`
    SELECT id, payment_approval_meta, assigned_agent_id
    FROM tickets WHERE ticket_number = 'REQ-2026-00013' LIMIT 1
  `;
  const row = rows[0]!;
  const meta = parsePaymentApprovalMeta(row.payment_approval_meta)!;
  const stamped = applyPaymentApprovalAssignees(meta, {
    notedByAgentId: row.assigned_agent_id,
  });
  const advanced = completePaymentApprovalStep(stamped);
  console.log("would advance to", advanced.proceduralStep, "completed", advanced.completed);

  // Check optimistic match without writing
  const check = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT (
      payment_approval_meta IS NULL
      OR payment_approval_meta->>'proceduralStep' = ${meta.proceduralStep}
    ) AS ok
    FROM tickets WHERE id = ${row.id}
  `;
  console.log("expected step match", check);

  // Portal accounts with similar name
  const portals = await prisma.portalAccount.findMany({
    where: {
      OR: [
        { email: { contains: "mangolayon", mode: "insensitive" } },
        { name: { contains: "Mangolayon", mode: "insensitive" } },
      ],
    },
    select: { email: true, name: true, role: true, mergedSourceUserId: true },
  });
  console.log("portals", portals);

  if (!dryRun) {
    const saved = await savePaymentApprovalMeta(row.id, advanced, meta.proceduralStep);
    console.log("saved", saved);
  } else {
    console.log("dry-run only (pass --apply to write)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
