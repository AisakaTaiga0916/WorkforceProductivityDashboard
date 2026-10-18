import { DateTime } from "luxon";
import { sendConfirmationReminderEmail } from "@/lib/email";
import { prisma } from "@/modules/platform/db/prisma";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";

export const CONFIRMATION_REMINDER_ACTIVITY = "Confirmation reminder sent";

let sweepRunning = false;

function reminderTimeZone() {
  return normalizeTimeZone(process.env.CONFIRMATION_REMINDER_TZ ?? process.env.REPORT_TZ ?? "Asia/Taipei");
}

function startOfTodayUtc(now = new Date()) {
  return DateTime.fromJSDate(now).setZone(reminderTimeZone()).startOf("day").toUTC().toJSDate();
}

function hasActivityAfter(
  activities: Array<{ summary: string; createdAt: Date }>,
  summaries: Set<string>,
  after: Date,
) {
  return activities.some((activity) => summaries.has(activity.summary) && activity.createdAt >= after);
}

export async function runForConfirmationReminderSweep(
  now = new Date(),
  options: { ticketId?: string } = {},
) {
  if (sweepRunning) {
    return {
      scanned: 0,
      reminded: 0,
      skipped: 0,
      cutoff: startOfTodayUtc(now).toISOString(),
      timeZone: reminderTimeZone(),
      alreadyRunning: true,
    };
  }
  sweepRunning = true;
  try {
    const cutoff = startOfTodayUtc(now);
    const tickets = await prisma.ticket.findMany({
      where: {
        ...(options.ticketId ? { id: options.ticketId } : {}),
        status: "FOR_CONFIRMATION",
        resolvedAt: { lt: cutoff },
      },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        contactName: true,
        contactEmail: true,
        requestorEmail: true,
        resolvedAt: true,
        resolutionNotes: true,
        activities: {
          where: {
            summary: {
              in: [
                CONFIRMATION_REMINDER_ACTIVITY,
                "Resolution verification approved",
                "Resolution verification rejected",
              ],
            },
          },
          select: { summary: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    let reminded = 0;
    let skipped = 0;
    const skipSummaries = new Set([
      CONFIRMATION_REMINDER_ACTIVITY,
      "Resolution verification approved",
      "Resolution verification rejected",
    ]);

    for (const ticket of tickets) {
      const resolvedAt = ticket.resolvedAt;
      if (!resolvedAt || hasActivityAfter(ticket.activities, skipSummaries, resolvedAt)) {
        skipped += 1;
        continue;
      }

      const recipientEmail = ticket.requestorEmail?.trim() || ticket.contactEmail;
      await sendConfirmationReminderEmail({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        recipientEmail,
        recipientName: ticket.contactName,
        resolutionNotes: ticket.resolutionNotes,
      });
      await prisma.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          actor: "SYSTEM",
          summary: CONFIRMATION_REMINDER_ACTIVITY,
          detail: `Follow-up confirmation reminder sent to ${recipientEmail}.`,
        },
      });
      reminded += 1;
    }

    return {
      scanned: tickets.length,
      reminded,
      skipped,
      cutoff: cutoff.toISOString(),
      timeZone: reminderTimeZone(),
    };
  } finally {
    sweepRunning = false;
  }
}
