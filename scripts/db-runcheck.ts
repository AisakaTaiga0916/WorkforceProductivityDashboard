/**
 * One-off health check: counts + samples + public table list (both databases).
 * Usage: npx tsx scripts/db-runcheck.ts
 */
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  await Promise.all([prismaPrimary.$connect(), prismaSecondary.$connect()]);
  console.log("Connected to both databases OK.\n");

  // --- Primary DB (PostgreSQL) ---
  console.log("=== Primary (PostgreSQL) ===");
  const [agents, tickets, portalAccounts] = await Promise.all([
    prismaPrimary.agent.count(),
    prismaPrimary.ticket.count(),
    prismaPrimary.portalAccount.count(),
  ]);
  console.log(
    JSON.stringify(
      { Agent: agents, Ticket: tickets, PortalAccount: portalAccounts },
      null,
      2,
    ),
  );

  const tables = await prismaPrimary.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log("\nPublic tables:", tables.map((t) => t.table_name).join(", "));

  // --- Secondary DB (MySQL mergeddatabase-dev) ---
  console.log("\n=== Secondary (MySQL mergeddatabase-dev) ===");
  const [mergedUsers, mergedClockIns, mergedTasks, mergedKpis] = await Promise.all([
    prismaSecondary.mergedUser.count(),
    prismaSecondary.mergedAttendanceClockIn.count(),
    prismaSecondary.mergedTaskItem.count(),
    prismaSecondary.mergedKpiMaintenance.count(),
  ]);
  console.log(
    JSON.stringify(
      {
        MergedUser: mergedUsers,
        MergedAttendanceClockIn: mergedClockIns,
        MergedTaskItem: mergedTasks,
        MergedKpiMaintenance: mergedKpis,
      },
      null,
      2,
    ),
  );

  const mysqlTables = await prismaSecondary.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = (SELECT DATABASE()) AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log("\nTables:", mysqlTables.map((t) => t.table_name).join(", "));

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error("DB check failed:", e);
    process.exit(1);
  })
  .finally(() => {
    void prismaPrimary.$disconnect();
    void prismaSecondary.$disconnect();
  });
