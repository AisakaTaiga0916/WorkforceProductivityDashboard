import type { TicketPriority } from "@prisma/client/primary";

/** Human-readable label for ticket priority (UI only). */
export function formatTicketPriorityLabel(priority: TicketPriority | string): string {
  if (priority === "UNSET") return "Set Priority Level";
  return String(priority);
}
