import { prisma } from "../../src/lib/prisma";
import { DateTime } from "luxon";
import { normalizeTimeZone } from "../../src/lib/kpi-recurrence";
import {
  recurringDeadlineExclusive,
  recurringTaskHasDelay,
  taskKanbanDerivedStatus,
} from "../../src/lib/kpi-cycle-state";

const TZ = "Asia/Taipei";

async function main() {
  const rows: any[] = await prisma.$queryRaw`
    SELECT id, title, main_task, is_recurring, frequency, sub_kpis, period_cycle_start_at, period_key,
           recurrence_weekday, recurrence_month_day
    FROM kpi_maintenance
    WHERE is_recurring = true AND frequency = 'DAILY'
    ORDER BY period_cycle_start_at DESC
  `;

  // Simulate 10:00 AM Taipei on 2026-08-12 (today)
  const nowMs = DateTime.fromISO("2026-08-12T10:00:00", { zone: TZ }).toMillis();
  console.log("now=" + DateTime.fromMillis(nowMs, { zone: TZ }).toISO());

  for (const r of rows) {
    const record = {
      isRecurring: r.is_recurring,
      frequency: r.frequency,
      recurrenceWeekday: r.recurrence_weekday,
      recurrenceMonthDay: r.recurrence_month_day,
      periodCycleStartAt: r.period_cycle_start_at,
      title: r.title,
      subKpis: r.sub_kpis,
    };
    let total = 0, done = 0;
    const subKpis = r.sub_kpis as any;
    const flat = Array.isArray(subKpis?.flat) ? subKpis.flat : [];
    const seg = Array.isArray(subKpis?.segments)
      ? subKpis.segments.flatMap((s: any) => s.items ?? [])
      : [];
    const all = [...flat, ...seg];
    for (const it of all) {
      total += 1;
      if (it.done || (it.pillarDone && false)) done += 1;
    }
    const status = taskKanbanDerivedStatus(record, { total, done, nowMs, timeZone: TZ });
    const deadline = recurringDeadlineExclusive(record, TZ);
    const hasDelay = recurringTaskHasDelay(record, nowMs, TZ);
    const anchorStr = r.period_cycle_start_at ? DateTime.fromJSDate(r.period_cycle_start_at, { zone: TZ }).toISODate() : String(r.period_cycle_start_at);
    const pastDueCustom = all.filter(
      (it) => it.dueDate && String(it.dueDate).match(/^\d{4}-\d{2}-\d{2}$/) && String(it.dueDate) < "2026-08-12" && !(it.done),
    ).map((it) => `${it.title}(${it.dueDate})`).slice(0, 4);
    console.log(
      `${status.padEnd(8)} anchor=${anchorStr} period=${r.period_key} items=${total} done=${done} delay=${hasDelay} deadline=${deadline ? DateTime.fromJSDate(deadline, { zone: TZ }).toISO() : "null"} pastDueCustom=[${pastDueCustom.join(", ")}] main=${r.main_task}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });