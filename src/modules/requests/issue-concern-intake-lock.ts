/**
 * Client-safe helpers for Issue/Concern intake lock messaging.
 * Keep Prisma / DB code out of this module so Client Components can import it.
 */

/** User-facing copy when Issue/Concern creation is blocked. */
export function issueConcernIntakeLockMessage(ticketNumber?: string | null): string {
  const ref = ticketNumber?.trim() ? ` (${ticketNumber.trim()})` : "";
  return (
    `You already have an Issue/Concern ticket${ref} that is assigned, in progress, or awaiting confirmation. ` +
    `Finish or close that ticket before creating another Issue/Concern ticket. ` +
    `You can still submit other request types (payment, requisition, fund transfer, job order).`
  );
}
