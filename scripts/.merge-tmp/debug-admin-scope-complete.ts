import { prisma } from "../../src/lib/prisma";
import { resolveStaffCompanyTeamId } from "../../src/lib/staff-company-scope";
import { adminOutsideCompanyScope } from "../../src/lib/ticket-staff-access";
import { parsePaymentApprovalMeta } from "../../src/lib/request-for-payment-approval";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00013" },
    select: {
      id: true,
      teamId: true,
      assignedAgentId: true,
      contactEmail: true,
      requestorEmail: true,
      paymentApprovalMeta: true,
      status: true,
    },
  });
  console.log("ticket", {
    ...ticket,
    meta: parsePaymentApprovalMeta(ticket?.paymentApprovalMeta),
  });

  const email = "lmangolayon@mconpincohomeimprovement.com";
  const scoped = await resolveStaffCompanyTeamId(email);
  const blocked = await adminOutsideCompanyScope({
    role: "Admin",
    email,
    ticketTeamId: ticket?.teamId ?? null,
    ticket: ticket ?? null,
  });
  console.log({ scoped, blocked, ticketTeamId: ticket?.teamId });

  // Also check approved-by agent
  const approvedId = parsePaymentApprovalMeta(ticket?.paymentApprovalMeta)?.approvedByAgentId;
  if (approvedId) {
    const approved = await prisma.agent.findUnique({
      where: { id: approvedId },
      select: { id: true, email: true, name: true },
    });
    const portal = approved?.email
      ? await prisma.portalAccount.findFirst({
          where: { email: { equals: approved.email, mode: "insensitive" } },
          select: { email: true, role: true },
        })
      : null;
    const aScoped = approved?.email ? await resolveStaffCompanyTeamId(approved.email) : null;
    const aBlocked =
      portal?.role === "Admin" && approved?.email
        ? await adminOutsideCompanyScope({
            role: "Admin",
            email: approved.email,
            ticketTeamId: ticket?.teamId ?? null,
            ticket: ticket ?? null,
          })
        : false;
    console.log("approvedBy", { approved, portal, aScoped, aBlocked });
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
