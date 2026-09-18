import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  customerPendingTicketHref,
  listTicketsAwaitingCustomerConfirmation,
} from "@/lib/customer-pending-resolution";
import { ensureTicketRemarksColumn } from "@/lib/ensure-ticket-remarks-column";
import { isTicketRequestorRole } from "@/lib/ticket-requestor";

/**
 * Tickets awaiting the signed-in requestor's confirmation (FOR_CONFIRMATION / RESOLVED).
 * Used by the post-login modal for Customer, Personnel, Admin, and SuperAdmin accounts.
 */
export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  if (!isTicketRequestorRole(role)) {
    return NextResponse.json({ tickets: [] });
  }

  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ tickets: [] });
  }

  await ensureTicketRemarksColumn();
  const rows = await listTicketsAwaitingCustomerConfirmation(email, session.user.authProvider);
  return NextResponse.json({
    tickets: rows.map((ticket) => {
      const remarks = typeof ticket.remarks === "string" ? ticket.remarks.trim() : "";
      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status,
        updatedAt: ticket.updatedAt.toISOString(),
        verificationHref: customerPendingTicketHref(ticket),
        remarks: remarks || null,
        hasRemarks: remarks.length > 0,
      };
    }),
  });
}
