import type { Prisma, TicketStatus } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import { resolveTicketContactFields } from "@/lib/ticket-intake-contact";

/**
 * Issue/Concern intake lock statuses.
 *
 * A requestor cannot create another **ISSUE/CONCERN TICKET** while they already have one that is:
 * - **Assigned** (has an assignee, still in the open pipeline), or
 * - **In Progress**, or
 * - **For Confirmation**.
 *
 * Other request types (RFP, IRS, FTR, Job Order, …) are never blocked by this rule.
 * Unassigned Issue/Concern tickets (waiting on the Assignment Board) do not lock intake.
 */
export const ISSUE_CONCERN_INTAKE_LOCK_ASSIGNED_STATUSES: TicketStatus[] = [
  "OPEN",
  "PENDING_INFO",
  "ESCALATED",
];

/** @deprecated Prefer {@link ISSUE_CONCERN_INTAKE_LOCK_ASSIGNED_STATUSES} — kept for callers that listed all lock statuses. */
export const CUSTOMER_INTAKE_LOCK_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_INFO",
  "ESCALATED",
  "FOR_CONFIRMATION",
];

export function isAwaitingCustomerConfirmation(status: TicketStatus) {
  return status === "FOR_CONFIRMATION" || status === "RESOLVED";
}

/** Deep link for a blocking ticket (verification flow vs. general ticket view). */
export function customerPendingTicketHref(row: { id: string; status: TicketStatus }) {
  return isAwaitingCustomerConfirmation(row.status)
    ? `/tickets/${row.id}/verification`
    : `/tickets/${row.id}`;
}

/** Tickets visible to a customer (portal contact or notification inbox). */
export function customerTicketWhereBySessionEmail(email: string): Prisma.TicketWhereInput {
  const e = email.trim().toLowerCase();
  if (!e) return { id: "__none__" };
  return {
    OR: [
      { contactEmail: { equals: e, mode: "insensitive" as const } },
      { requestorEmail: { equals: e, mode: "insensitive" as const } },
    ],
  };
}

/** OR-clause: ticket belongs to any of these emails as contact or requestor. */
export function requestorIdentityWhereForEmails(emails: Iterable<string>): Prisma.TicketWhereInput {
  const normalized = [
    ...new Set(
      [...emails]
        .map((e) => (e ?? "").trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  ];
  if (normalized.length === 0) return { id: "__none__" };
  return {
    OR: normalized.flatMap((e) => [
      { contactEmail: { equals: e, mode: "insensitive" as const } },
      { requestorEmail: { equals: e, mode: "insensitive" as const } },
    ]),
  };
}

/**
 * Prisma where: Issue/Concern tickets that block creating another Issue/Concern.
 * Does not match RFP / IRS / FTR / Job Order.
 */
export const intakeBlockingWhere = (emails: Iterable<string>): Prisma.TicketWhereInput => ({
  AND: [
    requestorIdentityWhereForEmails(emails),
    { requestType: "ISSUE_CONCERN_TICKET" },
    {
      OR: [
        { status: "IN_PROGRESS" },
        { status: "FOR_CONFIRMATION" },
        {
          AND: [
            { assignedAgentId: { not: null } },
            { status: { in: ISSUE_CONCERN_INTAKE_LOCK_ASSIGNED_STATUSES } },
          ],
        },
      ],
    },
  ],
});

/**
 * Any Issue/Concern ticket for this identity that blocks a new Issue/Concern submission.
 * Unassigned Issue/Concern tickets and all other request types never block.
 */
export async function requestorHasIntakeBlockingTicket(identityEmails: Iterable<string>) {
  const normalized = [
    ...new Set(
      [...identityEmails]
        .map((e) => (e ?? "").trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  ];
  if (normalized.length === 0) return null;
  return prisma.ticket.findFirst({
    where: intakeBlockingWhere(normalized),
    orderBy: { updatedAt: "desc" },
    select: { id: true, ticketNumber: true, updatedAt: true, status: true },
  });
}

/**
 * Same email set POST /api/tickets uses for intake lock (portal contact + notification inbox).
 * Must stay in sync with {@link resolveTicketContactFields} for customers.
 */
export async function resolveCustomerIntakeIdentityEmails(
  accountEmail: string,
  authProvider: string | null | undefined,
): Promise<string[]> {
  const e = accountEmail.trim().toLowerCase();
  if (!e) return [];
  try {
    const r = await resolveTicketContactFields({
      sessionEmail: e,
      authProvider,
      bodyRequestorEmail: undefined,
    });
    return [
      ...new Set(
        [r.contactEmail, r.requestorEmail]
          .map((x) => (x ?? "").trim().toLowerCase())
          .filter((x) => x.length > 0),
      ),
    ];
  } catch {
    return [e];
  }
}

export async function listIntakeBlockingTicketsForEmails(emails: Iterable<string>) {
  const normalized = [
    ...new Set(
      [...emails]
        .map((x) => (x ?? "").trim().toLowerCase())
        .filter((x) => x.length > 0),
    ),
  ];
  if (normalized.length === 0) return [];
  return prisma.ticket.findMany({
    where: intakeBlockingWhere(normalized),
    orderBy: { updatedAt: "desc" },
    select: { id: true, ticketNumber: true, updatedAt: true, status: true },
  });
}

/** @see {@link requestorHasIntakeBlockingTicket} — portal session identity (Customer or Personnel as requestor). */
export async function customerHasPendingResolvedTicket(
  accountEmail: string,
  authProvider?: string | null,
) {
  const emails = await resolveCustomerIntakeIdentityEmails(accountEmail, authProvider ?? null);
  return requestorHasIntakeBlockingTicket(emails);
}

export async function listCustomerPendingResolvedTickets(
  accountEmail: string,
  authProvider?: string | null,
) {
  const emails = await resolveCustomerIntakeIdentityEmails(accountEmail, authProvider ?? null);
  return listIntakeBlockingTicketsForEmails(emails);
}

/** Tickets where the requestor must confirm or reject the resolution. */
export async function listTicketsAwaitingCustomerConfirmation(
  accountEmail: string,
  authProvider?: string | null,
) {
  const emails = await resolveCustomerIntakeIdentityEmails(accountEmail, authProvider ?? null);
  const normalized = [
    ...new Set(
      [...emails]
        .map((x) => (x ?? "").trim().toLowerCase())
        .filter((x) => x.length > 0),
    ),
  ];
  if (normalized.length === 0) return [];
  return prisma.ticket.findMany({
    where: {
      ...requestorIdentityWhereForEmails(normalized),
      status: { in: ["FOR_CONFIRMATION", "RESOLVED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      updatedAt: true,
      remarks: true,
    },
  });
}

export { issueConcernIntakeLockMessage } from "@/lib/issue-concern-intake-lock";
