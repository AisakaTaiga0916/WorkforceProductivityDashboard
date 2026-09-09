/**
 * Verify running-request KPI credit vs Task Metrics personnel rules (LIVE).
 * Run: npx tsx scripts/.merge-tmp/verify-personnel-request-credit.ts
 */
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client/primary";
import { prisma } from "../../src/lib/prisma";
import { ACTIVE_REQUEST_STATUSES } from "../../src/lib/active-request-statuses";
import { parseAcaApprovalMeta } from "../../src/lib/aca-approval";
import { parsePaymentApprovalMeta } from "../../src/lib/request-for-payment-approval";
import { parseItemRequisitionApprovalMeta } from "../../src/lib/item-requisition-approval";
import { parseFundTransferApprovalMeta } from "../../src/lib/fund-transfer-approval";
import { loadAcaSubmittedPersonnelMetrics } from "../../src/lib/aca-role-kpis";
import { loadRfpRolePersonnelMetrics } from "../../src/lib/rfp-role-kpis";
import {
  loadFtrPreparedPersonnelMetrics,
  loadIrsCanvassPersonnelMetrics,
} from "../../src/lib/irs-ftr-role-kpis";
import { isKpiMetricsWorkingDay } from "../../src/lib/kpi-recurrence";

const TZ = "Asia/Manila";

function workingDaysThisMonth(): { start: Date; end: Date }[] {
  const now = DateTime.now().setZone(TZ);
  let cursor = now.startOf("month").startOf("day");
  const end = now.endOf("day");
  const out: { start: Date; end: Date }[] = [];
  while (cursor <= end) {
    if (isKpiMetricsWorkingDay(cursor)) {
      out.push({ start: cursor.toJSDate(), end: cursor.endOf("day").toJSDate() });
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

function submittedBy(meta: NonNullable<ReturnType<typeof parseAcaApprovalMeta>>) {
  return meta.levels.find((l) => l.key === "SUBMITTED_BY")?.agentId?.trim() || null;
}

async function main() {
  const now = DateTime.now().setZone(TZ);
  const workingDays = workingDaysThisMonth();

  const [
    acaRunning,
    rfpRunning,
    irsRunning,
    ftrRunning,
    acaMetrics,
    rfpMetrics,
    irsMetrics,
    ftrMetrics,
  ] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        requestType: "AUTHORITY_TO_CONDUCT_ACTIVITY",
        closedAt: null,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
        acaApprovalMeta: { not: Prisma.DbNull },
      },
      select: { id: true, ticketNumber: true, status: true, acaApprovalMeta: true },
    }),
    prisma.ticket.findMany({
      where: {
        requestType: "REQUEST_FOR_PAYMENT",
        closedAt: null,
        paymentApprovalMeta: { not: Prisma.DbNull },
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        assignedAgentId: true,
        paymentApprovalMeta: true,
      },
    }),
    prisma.ticket.findMany({
      where: {
        requestType: "ITEM_REQUISITION_SLIP",
        closedAt: null,
        itemRequisitionApprovalMeta: { not: Prisma.DbNull },
      },
      select: { id: true, ticketNumber: true, itemRequisitionApprovalMeta: true },
    }),
    prisma.ticket.findMany({
      where: {
        requestType: "FUND_TRANSFER_REQUEST",
        closedAt: null,
        fundTransferApprovalMeta: { not: Prisma.DbNull },
      },
      select: { id: true, ticketNumber: true, fundTransferApprovalMeta: true },
    }),
    loadAcaSubmittedPersonnelMetrics({}, workingDays),
    loadRfpRolePersonnelMetrics({}, workingDays),
    loadIrsCanvassPersonnelMetrics({}, workingDays),
    loadFtrPreparedPersonnelMetrics({}, workingDays),
  ]);

  const acaPendingExpected = new Map<string, number>();
  for (const t of acaRunning) {
    const meta = parseAcaApprovalMeta(t.acaApprovalMeta);
    const id = meta ? submittedBy(meta) : null;
    if (!id) continue;
    acaPendingExpected.set(id, (acaPendingExpected.get(id) ?? 0) + 1);
  }

  const acaPendingFromMetrics = new Map(acaMetrics.map((m) => [m.id, m.pending]));
  let acaMismatch = 0;
  for (const [id, expected] of acaPendingExpected) {
    const got = acaPendingFromMetrics.get(id) ?? 0;
    if (got !== expected) {
      acaMismatch += 1;
      console.log(`ACA mismatch agent=${id} expectedPending=${expected} metricsPending=${got}`);
    }
  }

  let rfpAcctPending = 0;
  let rfpFinPending = 0;
  for (const t of rfpRunning) {
    const meta = parsePaymentApprovalMeta(t.paymentApprovalMeta);
    if (!meta) continue;
    if (meta.proceduralStep === "APPROVED_BY_ACCOUNTING") rfpAcctPending += 1;
    if (meta.proceduralStep === "APPROVED_BY_FINANCE") rfpFinPending += 1;
  }
  const rfpAcctMetricsPending = rfpMetrics.accounting.reduce((s, m) => s + m.pending, 0);
  const rfpFinMetricsPending = rfpMetrics.finance.reduce((s, m) => s + m.pending, 0);

  let irsPending = 0;
  for (const t of irsRunning) {
    const meta = parseItemRequisitionApprovalMeta(t.itemRequisitionApprovalMeta);
    if (meta?.proceduralStep === "CANVASSED_BY") irsPending += 1;
  }
  const irsMetricsPending = irsMetrics.reduce((s, m) => s + m.pending, 0);

  let ftrPending = 0;
  for (const t of ftrRunning) {
    const meta = parseFundTransferApprovalMeta(t.fundTransferApprovalMeta);
    if (meta?.proceduralStep === "PREPARED_BY") ftrPending += 1;
  }
  const ftrMetricsPending = ftrMetrics.reduce((s, m) => s + m.pending, 0);

  console.log(
    JSON.stringify(
      {
        range: { month: now.toFormat("yyyy-MM"), tz: TZ, workingDays: workingDays.length },
        runningCounts: {
          aca: acaRunning.length,
          rfp: rfpRunning.length,
          irs: irsRunning.length,
          ftr: ftrRunning.length,
        },
        creditCheck: {
          acaSubmitted: {
            runningWithSubmitter: [...acaPendingExpected.values()].reduce((a, b) => a + b, 0),
            metricsPendingTotal: acaMetrics.reduce((s, m) => s + m.pending, 0),
            agentMismatches: acaMismatch,
            ok: acaMismatch === 0,
          },
          rfpAccounting: {
            runningAtStep: rfpAcctPending,
            metricsPending: rfpAcctMetricsPending,
            ok: rfpAcctPending === rfpAcctMetricsPending,
          },
          rfpFinance: {
            runningAtStep: rfpFinPending,
            metricsPending: rfpFinMetricsPending,
            ok: rfpFinPending === rfpFinMetricsPending,
          },
          irsCanvass: {
            runningAtStep: irsPending,
            metricsPending: irsMetricsPending,
            ok: irsPending === irsMetricsPending,
          },
          ftrPrepared: {
            runningAtStep: ftrPending,
            metricsPending: ftrMetricsPending,
            ok: ftrPending === ftrMetricsPending,
          },
        },
        sampleAcaSubmittedMetrics: acaMetrics.slice(0, 8),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
