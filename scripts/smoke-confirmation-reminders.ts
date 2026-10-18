/**
 * Smoke test: unresolved "For Confirmation" tickets get exactly one follow-up reminder.
 *
 * Usage:
 *   npx tsx scripts/smoke-confirmation-reminders.ts
 */
import { DateTime } from "luxon";
import { runForConfirmationReminderSweep, CONFIRMATION_REMINDER_ACTIVITY } from "../src/modules/requests/confirmation-reminders";
import { prisma } from "../src/modules/platform/db/prisma";

function fail(message: string): never {
  console.error("FAIL:", message);
  process.exit(1);
}

function pass(message: string) {
  console.log("PASS:", message);
}

async function main() {
  // Keep the smoke test local: verify reminder logic without sending a real SMTP message.
  process.env.BREVO_SMTP_USER = "";
  process.env.BREVO_SMTP_PASS = "";

  const now = new Date();
  const confirmationStartedAt = DateTime.now()
    .setZone(process.env.CONFIRMATION_REMINDER_TZ ?? process.env.REPORT_TZ ?? "Asia/Manila")
    .minus({ days: 1 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `SMOKE-REMINDER-${Date.now()}`,
      title: "Smoke confirmation reminder",
      description: "Temporary ticket used to verify confirmation reminder behavior.",
      category: "GENERAL",
      priority: "LOW",
      status: "FOR_CONFIRMATION",
      contactName: "Smoke Test User",
      contactEmail: "smoke.confirmation@example.com",
      requestorEmail: "smoke.confirmation@example.com",
      firstResponseDueAt: confirmationStartedAt,
      resolutionDueAt: confirmationStartedAt,
      firstResponseAt: confirmationStartedAt,
      resolvedAt: confirmationStartedAt,
      resolutionNotes: "Smoke test resolution notes.",
      createdAt: confirmationStartedAt,
    },
  });

  try {
    const firstRun = await runForConfirmationReminderSweep(now, { ticketId: ticket.id });
    if (firstRun.reminded !== 1) {
      fail(`Expected first sweep to remind 1 ticket, got ${JSON.stringify(firstRun)}`);
    }
    pass("first sweep sent one reminder");

    const firstActivityCount = await prisma.ticketActivity.count({
      where: { ticketId: ticket.id, summary: CONFIRMATION_REMINDER_ACTIVITY },
    });
    if (firstActivityCount !== 1) {
      fail(`Expected exactly one reminder activity after first run, got ${firstActivityCount}`);
    }
    pass("reminder activity marker was written");

    const secondRun = await runForConfirmationReminderSweep(now, { ticketId: ticket.id });
    if (secondRun.reminded !== 0) {
      fail(`Expected second sweep to send no duplicate reminders, got ${JSON.stringify(secondRun)}`);
    }
    pass("second sweep did not send a duplicate reminder");

    const finalActivityCount = await prisma.ticketActivity.count({
      where: { ticketId: ticket.id, summary: CONFIRMATION_REMINDER_ACTIVITY },
    });
    if (finalActivityCount !== 1) {
      fail(`Expected one reminder activity after duplicate check, got ${finalActivityCount}`);
    }
    pass("duplicate guard kept one reminder marker");

    console.log("Smoke confirmation reminder result:", {
      ticketNumber: ticket.ticketNumber,
      firstRun,
      secondRun,
    });
  } finally {
    await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
