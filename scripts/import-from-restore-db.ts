/**
 * Import live ticketing data from ticket_system_v3_restore (old PascalCase schema)
 * into the current ticketing_system database (snake_case Prisma schema).
 *
 * Prerequisites:
 *   pg_restore backup into ticket_system_v3_restore (see restore-ticketing-system-v3.ps1)
 *
 * Usage:
 *   npx tsx scripts/import-from-restore-db.ts --confirm
 */
import pg from "pg";
import { PrismaClient } from "@prisma/client/primary";

const SOURCE_URL =
  process.env.RESTORE_SOURCE_URL ??
  "postgresql://postgres:postgres@localhost:5432/ticket_system_v3_restore";

const prisma = new PrismaClient();

async function q<T extends pg.QueryResultRow>(client: pg.Client, sql: string) {
  return client.query<T>(sql);
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing without --confirm. This replaces ticketing data in DATABASE_URL_PRIMARY.");
    process.exit(1);
  }

  const src = new pg.Client({ connectionString: SOURCE_URL });
  await src.connect();

  const ticketCount = (await q<{ c: number }>(src, 'SELECT COUNT(*)::int AS c FROM public."Ticket"')).rows[0].c;
  console.log(`[import-from-restore] source tickets=${ticketCount}`);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      TRUNCATE TABLE
        account_action_requests,
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

    const teams = await q<{
      id: string;
      name: string;
      description: string | null;
      createdAt: Date;
    }>(src, 'SELECT id, name, description, "createdAt" FROM public."Team"');
    for (const row of teams.rows) {
      await tx.company.create({
        data: {
          id: row.id,
          name: row.name,
          description: row.description,
          createdAt: row.createdAt,
        },
      });
    }

    const sla = await q<{
      id: string;
      priority: string;
      firstResponseHours: number;
      resolutionHours: number;
    }>(src, 'SELECT id, priority, "firstResponseHours", "resolutionHours" FROM public."SlaPolicy"');
    for (const row of sla.rows) {
      await tx.slaPolicy.create({
        data: {
          id: row.id,
          priority: row.priority as never,
          firstResponseHours: row.firstResponseHours,
          resolutionHours: row.resolutionHours,
        },
      });
    }

    const esc = await q<{
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
    );
    for (const row of esc.rows) {
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

    const agents = await q<{
      id: string;
      name: string;
      email: string;
      teamId: string;
      createdAt: Date;
    }>(src, 'SELECT id, name, email, "teamId", "createdAt" FROM public."Agent"');
    for (const row of agents.rows) {
      await tx.agent.create({
        data: {
          id: row.id,
          name: row.name,
          email: row.email,
          teamId: row.teamId,
          createdAt: row.createdAt,
        },
      });
    }

    const portals = await q<{
      id: string;
      email: string;
      name: string;
      passwordHash: string | null;
      role: string;
      createdAt: Date;
      username: string | null;
      accountStatus: string | null;
      profileImage: string | null;
      profileImagePosX: number | null;
      profileImagePosY: number | null;
      profileImageZoom: number | null;
    }>(
      src,
      `SELECT id, email, name, "passwordHash", role, "createdAt", username, "accountStatus",
              "profileImage", "profileImagePosX", "profileImagePosY", "profileImageZoom"
       FROM public."PortalAccount"`,
    );
    for (const row of portals.rows) {
      await tx.portalAccount.create({
        data: {
          id: row.id,
          email: row.email.trim().toLowerCase(),
          name: row.name,
          passwordHash: row.passwordHash,
          role: row.role,
          createdAt: row.createdAt,
          username: row.username?.trim().toLowerCase() ?? null,
          accountStatus: row.accountStatus ?? "ACTIVE",
          profileImage: row.profileImage,
          profileImagePosX: row.profileImagePosX ?? 50,
          profileImagePosY: row.profileImagePosY ?? 50,
          profileImageZoom: row.profileImageZoom ?? 1,
        },
      });
    }

    const tickets = await q<Record<string, unknown>>(src, 'SELECT * FROM public."Ticket"');
    for (const row of tickets.rows) {
      await tx.ticket.create({
        data: {
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
          intakeScreenshotMeta: null,
          createdAt: row.createdAt as Date,
          updatedAt: row.updatedAt as Date,
        },
      });
    }

    const activities = await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketActivity"');
    for (const row of activities.rows) {
      await tx.ticketActivity.create({
        data: {
          id: row.id as string,
          ticketId: row.ticketId as string,
          actor: row.actor as never,
          summary: row.summary as string,
          detail: (row.detail as string | null) ?? null,
          createdAt: row.createdAt as Date,
        },
      });
    }

    const messages = await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketMessage"');
    for (const row of messages.rows) {
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

    const feedback = await q<Record<string, unknown>>(src, 'SELECT * FROM public."TicketFeedback"');
    for (const row of feedback.rows) {
      await tx.ticketFeedback.create({
        data: {
          id: row.id as string,
          ticketId: row.ticketId as string,
          csat: row.csat as number,
          nps: (row.nps as number | null) ?? null,
          ces: (row.ces as number | null) ?? null,
          comment: (row.comment as string | null) ?? null,
          createdAt: row.createdAt as Date,
        },
      });
    }

    const kpis = await q<Record<string, unknown>>(src, 'SELECT * FROM public."KpiMaintenance"');
    for (const row of kpis.rows) {
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

    const tasks = await q<Record<string, unknown>>(src, 'SELECT * FROM public."TaskItem"');
    for (const row of tasks.rows) {
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

    const taskActs = await q<Record<string, unknown>>(src, 'SELECT * FROM public."TaskActivity"');
    for (const row of taskActs.rows) {
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

    const actionReqs = await q<Record<string, unknown>>(src, 'SELECT * FROM public."AccountActionRequest"');
    for (const row of actionReqs.rows) {
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
  });

  const after = await prisma.ticket.count();
  console.log(`[import-from-restore] imported tickets=${after}`);
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
