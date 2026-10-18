/**
 * Helper queries for user efficiency breakdowns.
 *
 * Source of truth: MySQL mergedatabase (`merged_user_efficiency_breakdowns`).
 * Ticket metrics / ticket activity stay in PostgreSQL primary — not queried here.
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import type { EfficiencyFrequency } from "@/modules/tasks/efficiency/user-efficiency-breakdown";

function resolveMergedUrl(): string {
  return (
    process.env.DATABASE_URL_SECONDARY?.trim() ||
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
    "mysql://root@localhost:3306/mergedatabase-demo"
  );
}

export function createEfficiencyQueryClient(url = resolveMergedUrl()) {
  return new PrismaClientSecondary({ datasources: { db: { url } } });
}

/** Get efficiency for a user in a period (+ optional task drill-down). */
export async function getUserEfficiencyForPeriod(
  db: PrismaClientSecondary,
  args: {
    sourceUserId: bigint | number | string;
    periodKey: string;
    frequency: EfficiencyFrequency | string;
    includeDetails?: boolean;
  },
) {
  const sourceUserId = BigInt(args.sourceUserId);
  if (args.includeDetails) {
    return db.mergedUserEfficiencyBreakdown.findUnique({
      where: {
        sourceUserId_periodKey_frequency: {
          sourceUserId,
          periodKey: args.periodKey,
          frequency: args.frequency,
        },
      },
      include: { taskDetails: { orderBy: { taskTitle: "asc" } } },
    });
  }
  return db.mergedUserEfficiencyBreakdown.findUnique({
    where: {
      sourceUserId_periodKey_frequency: {
        sourceUserId,
        periodKey: args.periodKey,
        frequency: args.frequency,
      },
    },
  });
}

/** Leaderboard by overall efficiency for a period. */
export async function getEfficiencyLeaderboard(
  db: PrismaClientSecondary,
  args: {
    periodKey: string;
    frequency: EfficiencyFrequency | string;
    limit?: number;
  },
) {
  return db.mergedUserEfficiencyBreakdown.findMany({
    where: {
      periodKey: args.periodKey,
      frequency: args.frequency,
    },
    orderBy: [{ overallEfficiency: "desc" }, { displayName: "asc" }],
    take: Math.min(Math.max(args.limit ?? 50, 1), 500),
    select: {
      id: true,
      sourceUserId: true,
      displayName: true,
      periodKey: true,
      frequency: true,
      overallEfficiency: true,
      taskEfficiency: true,
      ticketEfficiency: true,
      totalTasks: true,
      completedTasks: true,
      delayedTasks: true,
      onTimeCompletionRate: true,
      computedAt: true,
    },
  });
}

/** Detailed task breakdown for a user/period. */
export async function getUserEfficiencyTaskBreakdown(
  db: PrismaClientSecondary,
  args: {
    sourceUserId: bigint | number | string;
    periodKey: string;
    frequency: EfficiencyFrequency | string;
  },
) {
  const row = await db.mergedUserEfficiencyBreakdown.findUnique({
    where: {
      sourceUserId_periodKey_frequency: {
        sourceUserId: BigInt(args.sourceUserId),
        periodKey: args.periodKey,
        frequency: args.frequency,
      },
    },
    include: { taskDetails: { orderBy: { taskTitle: "asc" } } },
  });
  return row?.taskDetails ?? [];
}
