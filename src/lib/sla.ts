import type { SlaPolicy, TicketPriority } from "@prisma/client/primary";
import { prisma } from "./prisma";

export {
  BOARD_LANE_AT_RISK_HOURS,
  BOARD_LANE_AT_RISK_MS,
  BOARD_LANE_OVERDUE_MS,
  addHours,
  boardLaneEnteredAtMs,
  didRequestBoardLaneChange,
  getTicketSlaState,
  isBoardLaneOverdue,
  isOnRequestBoard,
  isUnresolvedRequestStatus,
  overdueClockStartedAtMs,
  type OverdueTicketInput,
  type SlaState,
} from "@/lib/sla-shared";

export async function getSlaPolicy(priority: TicketPriority): Promise<SlaPolicy> {
  const policy = await prisma.slaPolicy.findUnique({ where: { priority } });
  if (!policy) {
    throw new Error(`Missing SLA policy for priority ${priority}`);
  }
  return policy;
}

/** SLA sweep no longer auto-escalates; personnel use Request for transfer instead. */
export async function runSlaEscalationSweep() {
  const scanned = await prisma.ticket.count({
    where: { status: { notIn: ["FOR_CONFIRMATION", "RESOLVED", "CLOSED"] } },
  });
  return { scanned, escalated: 0 };
}
