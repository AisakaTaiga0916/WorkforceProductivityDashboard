import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  customerHasPendingResolvedTicket,
  customerPendingTicketHref,
  issueConcernIntakeLockMessage,
} from "@/modules/requests/customer-pending-resolution";
import { isTicketRequestorRole } from "@/modules/requests/ticket-requestor";

/**
 * Whether the signed-in user may open another **Issue/Concern** ticket as requestor.
 * Other request types are never locked by this endpoint.
 */
export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  if (!isTicketRequestorRole(role)) {
    return NextResponse.json({
      canCreateTickets: true,
      canCreateIssueConcern: true,
      authProvider: session.user.authProvider ?? null,
      pendingConfirmation: null,
      message: null,
    });
  }

  const email = (session.user.email ?? "").trim().toLowerCase();
  const pending = email
    ? await customerHasPendingResolvedTicket(email, session.user.authProvider)
    : null;

  const canCreateIssueConcern = !pending;

  return NextResponse.json({
    /** @deprecated Prefer `canCreateIssueConcern` — false only blocks Issue/Concern. */
    canCreateTickets: canCreateIssueConcern,
    canCreateIssueConcern,
    authProvider: session.user.authProvider ?? null,
    pendingConfirmation: pending
      ? {
          ticketId: pending.id,
          ticketNumber: pending.ticketNumber,
          verificationHref: customerPendingTicketHref(pending),
        }
      : null,
    message: pending ? issueConcernIntakeLockMessage(pending.ticketNumber) : null,
  });
}
