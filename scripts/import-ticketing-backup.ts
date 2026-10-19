/**
 * Import ticketing-system tables from a PostgreSQL custom-format dump (.sql PGDMP)
 * into DATABASE_URL_PRIMARY (ticketing_system). Skips _prisma_migrations.
 *
 * Ticketing tables imported:
 *   Team, Agent, PortalAccount, SlaPolicy, EscalationTrigger,
 *   Ticket, TicketActivity, TicketMessage, TicketFeedback,
 *   KpiMaintenance, KpiMaintenancePeriodSnapshot,
 *   TaskItem, TaskActivity, AccountActionRequest, HelpdeskCsvTicket
 *
 * Usage:
 *   npx tsx scripts/import-ticketing-backup.ts --dump "C:\path\ticketing_system_07.03.2026.sql" --confirm
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client/primary";

const DEFAULT_DUMP =
  "C:\\Users\\jlsms\\OneDrive\\Desktop\\updated db\\JULY DATA BACKUPS\\ticketing_system_07.03.2026.sql";
const TEMP_DB = process.env.RESTORE_TEMP_DB ?? "ticketing_system_july_restore";
const PG_BIN = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";

function parseArgs() {
  const confirm = process.argv.includes("--confirm");
  const dumpIdx = process.argv.indexOf("--dump");
  const dump =
    (dumpIdx >= 0 ? process.argv[dumpIdx + 1] : null) ??
    process.env.RESTORE_DUMP_PATH ??
    DEFAULT_DUMP;
  return { confirm, dump };
}

function psql(args: string[], db = "postgres") {
  const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" };
  execFileSync(`${PG_BIN}\\psql.exe`, ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", db, ...args], {
    env,
    stdio: "inherit",
  });
}

function pgRestore(dumpPath: string) {
  const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" };
  execFileSync(
    `${PG_BIN}\\pg_restore.exe`,
    ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", TEMP_DB, "--no-owner", "--no-acl", dumpPath],
    { env, stdio: "inherit" },
  );
}

async function q<T extends pg.QueryResultRow>(client: pg.Client, sql: string) {
  return client.query<T>(sql);
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const r = await q<{ ok: boolean }>(
    client,
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${table}'
    ) AS ok`,
  );
  return Boolean(r.rows[0]?.ok);
}

const prisma = new PrismaClient();

async function main() {
  const { confirm, dump } = parseArgs();
  if (!confirm) {
    console.error("Refusing without --confirm. Example:");
    console.error(
      '  npx tsx scripts/import-ticketing-backup.ts --dump "C:\\path\\backup.sql" --confirm',
    );
    process.exit(1);
  }

  console.log(`[import-ticketing-backup] dump=${dump}`);
  console.log(`[import-ticketing-backup] temp DB=${TEMP_DB} -> target DATABASE_URL_PRIMARY`);

  psql(["-c", `DROP DATABASE IF EXISTS ${TEMP_DB} WITH (FORCE);`]);
  psql(["-c", `CREATE DATABASE ${TEMP_DB} ENCODING 'UTF8';`]);
  pgRestore(dump);

  const src = new pg.Client({
    connectionString: `postgresql://postgres:${process.env.PGPASSWORD ?? "postgres"}@localhost:5432/${TEMP_DB}`,
  });
  await src.connect();

  const counts = await q<{ t: string; c: number }>(src, `
    SELECT 'Ticket' AS t, COUNT(*)::int AS c FROM public."Ticket"
    UNION ALL SELECT 'PortalAccount', COUNT(*)::int FROM public."PortalAccount"
    UNION ALL SELECT 'Agent', COUNT(*)::int FROM public."Agent"
    UNION ALL SELECT 'Team', COUNT(*)::int FROM public."Team"
  `);
  console.log("[import-ticketing-backup] source:", Object.fromEntries(counts.rows.map((r) => [r.t, r.c])));

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`
        TRUNCATE TABLE
          account_action_requests,
          helpdesk_csv_tickets,
          task_activities,
          task_items,
          kpi_maintenance_period_snapshots,
          kpi_maintenance,
          ticket_feedbacks,
          ticket_messages,
          ticket_activities,
          tickets,
          portal_accounts,
          agents,
          escalation_triggers,
          sla_policies,
          teams
        RESTART IDENTITY CASCADE
      `);

      for (const row of (
        await q<{ id: string; name: string; description: string | null; createdAt: Date }>(
          src,
          'SELECT id, name, description, "createdAt" FROM public."Team"',
        )
      ).rows) {
        await tx.company.create({ data: row });
      }

      for (const row of (
        await q<{ id: string; priority: string; firstResponseHours: number; resolutionHours: number }>(
          src,
          'SELECT id, priority, "firstResponseHours", "resolutionHours" FROM public."SlaPolicy"',
        )
      ).rows) {
        await tx.slaPolicy.create({
          data: {
            id: row.id,
            priority: row.priority as never,
            firstResponseHours: row.firstResponseHours,
            resolutionHours: row.resolutionHours,
          },
        });
      }

      for (const row of (
        await q<{
          id: string;
          priority: string;
          enabled: boolean;
          notifyAdmin: boolean;
          notifyTarget: string;
          createdAt: Date;
          updatedAt: Date;
        }>(
          src,
          'SELECT id, priority, enabled, "notifyAdmin", "notifyTarget", "createdAt", "updatedAt" FROM public."EscalationTrigger"',
        )
      ).rows) {
        await tx.escalationTrigger.create({
          data: {
            id: row.id,
            priority: row.priority as never,
            enabled: row.enabled,
            notifyAdmin: row.notifyAdmin,
            notifyTarget: row.notifyTarget,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      }

      for (const row of (
        await q<{ id: string; name: string; email: string; teamId: string; createdAt: Date }>(
          src,
          'SELECT id, name, email, "teamId", "createdAt" FROM public."Agent"',
        )
      ).rows) {
        await tx.agent.create({ data: row });
      }

      for (const row of (
        await q<Record<string, unknown>>(src, 'SELECT * FROM public."PortalAccount"')
      ).rows) {
        await tx.portalAccount.create({
          data: {
            id: row.id as string,
            email: String(row.email).trim().toLowerCase(),
            name: row.name as string,
            passwordHash: (row.passwordHash as string | null) ?? null,
            role: row.role as string,
            createdAt: row.createdAt as Date,
            username: row.username ? String(row.username).trim().toLowerCase() : null,
            accountStatus: (row.accountStatus as string) ?? "ACTIVE",
            profileImage: (row.profileImage as string | null) ?? null,
            profileImagePosX: (row.profileImagePosX as number | null) ?? 50,
            profileImagePosY: (row.profileImagePosY as number | null) ?? 50,
            profileImageZoom: (row.profileImageZoom as number | null) ?? 1,
            headPrivileges: Boolean(row.headPrivileges),
            companyId: (row.companyId as string | null) ?? null,
            customerOrgRole: (row.customerOrgRole as string | null) ?? null,
            staffDesignatedCompanyId: (row.staffDesignatedCompanyId as string | null) ?? null,
            staffAssignmentColor: (row.staffAssignmentColor as string | null) ?? null,
          },
        });
      }

      const ticketRows = (await q<Record<string, unknown>>(src, 'SELECT * FROM public."Ticket"')).rows;
      const ticketBatch = 50;
      for (let i = 0; i < ticketRows.length; i += ticketBatch) {
        await tx.ticket.createMany({
          data: ticketRows.slice(i, i + ticketBatch).map((row) => ({
            id: row.id as string,
            ticketNumber: row.ticketNumber as string,
            title: row.title as string,
            description: row.description as string,
            category: row.category as never,
            priority: row.priority as never,
            status: row.status as never,
            contactName: row.contactName as string,
            contactEmail: row.contactEmail as string,
            requestorEmail: (row.requestorEmail as string | null) ?? null,
            contactPhone: (row.contactPhone as string | null) ?? null,
            teamId: (row.teamId as string | null) ?? null,
            assignedAgentId: (row.assignedAgentId as string | null) ?? null,
            firstResponseDueAt: row.firstResponseDueAt as Date,
            resolutionDueAt: row.resolutionDueAt as Date,
            firstResponseAt: (row.firstResponseAt as Date | null) ?? null,
            resolvedAt: (row.resolvedAt as Date | null) ?? null,
            closedAt: (row.closedAt as Date | null) ?? null,
            escalationType: (row.escalationType as never) ?? null,
            escalatedAt: (row.escalatedAt as Date | null) ?? null,
            reopenCount: (row.reopenCount as number) ?? 0,
            resolutionNotes: (row.resolutionNotes as string | null) ?? null,
            intakeScreenshotMeta: (row.intakeScreenshotMeta as never) ?? null,
            createdAt: row.createdAt as Date,
            updatedAt: row.updatedAt as Date,
          })),
        });
      }

      const activityRows = (await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketActivity"')).rows;
      for (let i = 0; i < activityRows.length; i += 200) {
        await tx.ticketActivity.createMany({
          data: activityRows.slice(i, i + 200).map((row) => ({
            id: row.id as string,
            ticketId: row.ticketId as string,
            actor: row.actor as never,
            summary: row.summary as string,
            detail: (row.detail as string | null) ?? null,
            createdAt: row.createdAt as Date,
          })),
        });
      }

      for (const row of (await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketMessage"')).rows) {
        await tx.ticketMessage.create({
          data: {
            id: row.id as string,
            ticketId: row.ticketId as string,
            actor: row.actor as never,
            author: row.author as string,
            body: row.body as string,
            createdAt: row.createdAt as Date,
          },
        });
      }

      const feedbackRows = (await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketFeedback"')).rows;
      for (let i = 0; i < feedbackRows.length; i += 100) {
        await tx.ticketFeedback.createMany({
          data: feedbackRows.slice(i, i + 100).map((row) => ({
            id: row.id as string,
            ticketId: row.ticketId as string,
            csat: row.csat as number,
            nps: (row.nps as number | null) ?? null,
            ces: (row.ces as number | null) ?? null,
            comment: (row.comment as string | null) ?? null,
            createdAt: row.createdAt as Date,
          })),
        });
      }

      for (const row of (await q<Record<string, unknown>>(src, 'SELECT * FROM public."KpiMaintenance"')).rows) {
        await tx.kpiMaintenance.create({
          data: {
            id: row.id as string,
            title: row.title as string,
            mainTask: (row.mainTask as string | null) ?? null,
            isRecurring: Boolean(row.isRecurring),
            nonRecurringStartAt: (row.nonRecurringStartAt as Date | null) ?? null,
            nonRecurringEndAt: (row.nonRecurringEndAt as Date | null) ?? null,
            frequency: row.frequency as never,
            subKpis: row.subKpis as never,
            assignedAgentId: (row.assignedAgentId as string | null) ?? null,
            assignedRole: (row.assignedRole as string | null) ?? null,
            recurrenceWeekday: (row.recurrenceWeekday as number | null) ?? null,
            recurrenceMonthDay: (row.recurrenceMonthDay as number | null) ?? null,
            periodCycleStartAt: (row.periodCycleStartAt as Date | null) ?? null,
            lastFullCompletionAt: (row.lastFullCompletionAt as Date | null) ?? null,
            periodKey: (row.periodKey as string | null) ?? null,
            rolledOverIncomplete: Boolean(row.rolledOverIncomplete),
            itProjectName: (row.itProjectName as string | null) ?? null,
            itProjectPhase: (row.itProjectPhase as string | null) ?? null,
            scopedCompanyTeamId: (row.scopedCompanyTeamId as string | null) ?? null,
            createdBy: row.createdBy as string,
            createdByRole: row.createdByRole as string,
            createdAt: row.createdAt as Date,
            updatedAt: row.updatedAt as Date,
          },
        });
      }

      if (await tableExists(src, "KpiMaintenancePeriodSnapshot")) {
        const snapRows = (
          await q<Record<string, unknown>>(src, 'SELECT * FROM public."KpiMaintenancePeriodSnapshot"')
        ).rows;
        for (let i = 0; i < snapRows.length; i += 100) {
          await tx.kpiMaintenancePeriodSnapshot.createMany({
            data: snapRows.slice(i, i + 100).map((row) => ({
              id: row.id as string,
              kpiMaintenanceId: row.kpiMaintenanceId as string,
              periodKey: row.periodKey as string,
              frequency: row.frequency as never,
              timeZone: row.timeZone as string,
              total: row.total as number,
              done: row.done as number,
              missing: row.missing as number,
              percent: row.percent as number,
              fullyComplete: Boolean(row.fullyComplete),
              contributorProgress: (row.contributorProgress as never) ?? null,
              capturedAt: row.capturedAt as Date,
            })),
          });
        }
      }

      for (const row of (await q<Record<string, unknown>>(src, 'SELECT * FROM public."TaskItem"')).rows) {
        await tx.taskItem.create({
          data: {
            id: row.id as string,
            title: row.title as string,
            description: (row.description as string | null) ?? null,
            status: row.status as never,
            assignedAgentId: (row.assignedAgentId as string | null) ?? null,
            priority: (row.priority as string | null) ?? null,
            dueAt: (row.dueAt as Date | null) ?? null,
            createdBy: row.createdBy as string,
            createdByRole: row.createdByRole as string,
            createdAt: row.createdAt as Date,
            updatedAt: row.updatedAt as Date,
          },
        });
      }

      for (const row of (await q<Record<string, unknown>>(src, 'SELECT * FROM public."TaskActivity"')).rows) {
        await tx.taskActivity.create({
          data: {
            id: row.id as string,
            taskId: row.taskId as string,
            author: row.author as string,
            action: row.action as string,
            detail: (row.detail as string | null) ?? null,
            createdAt: row.createdAt as Date,
          },
        });
      }

      for (const row of (
        await q<Record<string, unknown>>(src, 'SELECT * FROM public."AccountActionRequest"')
      ).rows) {
        await tx.accountActionRequest.create({
          data: {
            id: row.id as string,
            portalAccountId: row.portalAccountId as string,
            requestType: row.requestType as string,
            reason: (row.reason as string | null) ?? null,
            status: (row.status as string) ?? "PENDING",
            reviewedBy: (row.reviewedBy as string | null) ?? null,
            reviewedAt: (row.reviewedAt as Date | null) ?? null,
            createdAt: row.createdAt as Date,
            updatedAt: row.updatedAt as Date,
          },
        });
      }

      if (await tableExists(src, "HelpdeskCsvTicket")) {
        const csvRows = (await q<Record<string, unknown>>(src, 'SELECT * FROM public."HelpdeskCsvTicket"')).rows;
        for (let i = 0; i < csvRows.length; i += 100) {
          await tx.helpdeskCsvTicket.createMany({
            data: csvRows.slice(i, i + 100).map((row) => ({
              id: row.id as string,
              sheetRowId: row.sheetRowId as string,
              reportedAt: row.reportedAt as Date,
              resolvedAt: (row.resolvedAt as Date | null) ?? null,
              statusRaw: row.statusRaw as string,
              normalizedBucket: row.normalizedBucket as string,
              userEmail: (row.userEmail as string | null) ?? null,
              createdAt: row.createdAt as Date,
              updatedAt: row.updatedAt as Date,
            })),
          });
        }
      }
    },
    { timeout: 300_000 },
  );

  const summary = {
    tickets: await prisma.ticket.count(),
    portalAccounts: await prisma.portalAccount.count(),
    agents: await prisma.agent.count(),
    teams: await prisma.company.count(),
    ticketActivities: await prisma.ticketActivity.count(),
    helpdeskCsv: await prisma.helpdeskCsvTicket.count(),
    kpiSnapshots: await prisma.kpiMaintenancePeriodSnapshot.count(),
  };
  console.log("[import-ticketing-backup] imported:", summary);

  await src.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
