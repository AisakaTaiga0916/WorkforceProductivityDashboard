import { prisma } from "@/modules/platform/db/prisma";

/** Reads the ticket's intake request_type column (raw SQL — kept off the Prisma model). */
export async function loadTicketRequestType(ticketId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ request_type: string | null }>>`
    SELECT request_type FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  return (rows[0]?.request_type ?? "ISSUE_CONCERN_TICKET").trim() || "ISSUE_CONCERN_TICKET";
}
