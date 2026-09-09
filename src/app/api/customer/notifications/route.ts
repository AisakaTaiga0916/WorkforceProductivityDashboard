import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  customerPendingTicketHref,
  isAwaitingCustomerConfirmation,
  listIntakeBlockingTicketsForEmails,
  requestorHasIntakeBlockingTicket,
  requestorIdentityWhereForEmails,
  resolveCustomerIntakeIdentityEmails,
} from "@/lib/customer-pending-resolution";
import { createEmailVerificationToken } from "@/lib/email-verification-token";
import { prisma } from "@/lib/prisma";

export type CustomerNotification = {
  id: string;
  ticketId: string;
  ticketNumber: string;
  summary: string;
  detail: string | null;
  createdAt: string;
  href: string;
};

export type CustomerIntakePayload = {
  /** False when Issue/Concern creation is locked (other request types remain allowed). */
  canCreateTickets: boolean;
  canCreateIssueConcern: boolean;
  authProvider: string | null;
  pendingConfirmation: {
    ticketId: string;
    ticketNumber: string;
    verificationHref: string;
  } | null;
};

export async function GET() {
  const startedAt = Date.now();
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "Customer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = (session.user.email ?? "").trim().toLowerCase();
  const identityEmails = await resolveCustomerIntakeIdentityEmails(email, session.user.authProvider);
  const [pendingPrimary, pendingList, activities] = await Promise.all([
    requestorHasIntakeBlockingTicket(identityEmails),
    listIntakeBlockingTicketsForEmails(identityEmails),
    prisma.ticketActivity.findMany({
      where: {
        OR: [
          { summary: { in: ["Status → IN_PROGRESS", "Resolution email sent"] } },
          { summary: { startsWith: "Priority →" } },
        ],
        ticket: requestorIdentityWhereForEmails(identityEmails),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        ticket: {
          select: {
            id: true,
            ticketNumber: true,
            requestorEmail: true,
            contactEmail: true,
          },
        },
      },
    }),
  ]);

  const pendingNotifications: CustomerNotification[] = pendingList.map((t) => ({
    id: `pending-intake-lock-${t.id}`,
    ticketId: t.id,
    ticketNumber: t.ticketNumber,
    summary: "PENDING_INTAKE_LOCK",
    detail: isAwaitingCustomerConfirmation(t.status)
      ? "You have a ticket awaiting your confirmation. Confirm and close it before opening a new request."
      : "You have a ticket in progress. Close it or wait until it is awaiting confirmation or closed before opening a new request.",
    createdAt: t.updatedAt.toISOString(),
    href: customerPendingTicketHref(t),
  }));

  const activityRows: CustomerNotification[] = activities.map((a) => {
    const isVerify = a.summary === "Resolution email sent";
    const targetEmail = (a.ticket.requestorEmail ?? a.ticket.contactEmail).toLowerCase();
    const href = isVerify
      ? `/customer/verification/email?token=${encodeURIComponent(
          createEmailVerificationToken(a.ticket.id, targetEmail),
        )}`
      : `/tickets/${a.ticket.id}`;
    return {
      id: a.id,
      ticketId: a.ticket.id,
      ticketNumber: a.ticket.ticketNumber,
      summary: a.summary,
      detail: a.detail,
      createdAt: a.createdAt.toISOString(),
      href,
    };
  });

  const byTicket = new Map<string, CustomerNotification>();
  for (const n of [...pendingNotifications, ...activityRows]) {
    const existing = byTicket.get(n.ticketId);
    if (!existing) {
      byTicket.set(n.ticketId, n);
      continue;
    }
    const pri = (s: string) =>
      s === "PENDING_INTAKE_LOCK" ? 3 : s === "Resolution email sent" ? 2 : 1;
    if (pri(n.summary) > pri(existing.summary)) byTicket.set(n.ticketId, n);
    else if (pri(n.summary) === pri(existing.summary)) {
      const a = new Date(existing.createdAt).getTime();
      const b = new Date(n.createdAt).getTime();
      if (b > a) byTicket.set(n.ticketId, n);
    }
  }

  const notifications = [...byTicket.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const intake: CustomerIntakePayload = {
    canCreateTickets: !pendingPrimary,
    canCreateIssueConcern: !pendingPrimary,
    authProvider: session.user.authProvider ?? null,
    pendingConfirmation: pendingPrimary
      ? {
          ticketId: pendingPrimary.id,
          ticketNumber: pendingPrimary.ticketNumber,
          verificationHref: customerPendingTicketHref(pendingPrimary),
        }
      : null,
  };

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[perf] GET /api/customer/notifications ${Date.now() - startedAt}ms rows=${notifications.length}`,
    );
  }
  return NextResponse.json({ notifications, intake });
}
