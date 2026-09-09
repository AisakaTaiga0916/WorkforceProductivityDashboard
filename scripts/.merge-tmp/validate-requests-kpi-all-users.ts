/**
 * Validate REQUESTS KPI credit for all users (LIVE).
 *
 * Cross-checks computeTaskMetrics against an independent recount of tickets:
 * - Assignee credit (Issue/Concern, Job Order, other non-procedural)
 * - Role credit (RFP Accounting/Finance, IRS Canvass, FTR Prepared, ACA Submitted)
 * - Merged per-user Requests % used on Insights personnel cards
 * - Company REQUEST SUPPORT % formula
 *
 * Run: npx tsx scripts/.merge-tmp/validate-requests-kpi-all-users.ts
 * Optional: FROM=2026-08-01 TO=2026-08-08 TZ=Asia/Manila npx tsx ...
 */
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client/primary";
import { prisma } from "../../src/lib/prisma";
import { ACTIVE_REQUEST_STATUSES, OPEN_PIPELINE_STATUSES } from "../../src/lib/active-request-statuses";
import { parseAcaApprovalMeta } from "../../src/lib/aca-approval";
import { parsePaymentApprovalMeta } from "../../src/lib/request-for-payment-approval";
import { parseItemRequisitionApprovalMeta } from "../../src/lib/item-requisition-approval";
import { parseFundTransferApprovalMeta } from "../../src/lib/fund-transfer-approval";
import {
  computeTaskMetrics,
  helpdeskSupportPercent,
  type PersonnelTicketMetric,
} from "../../src/lib/kpis";
import {
  enumerateYmdDaysInRange,
  snapshotTimeZoneForTaskMetrics,
} from "../../src/lib/kpi-period-snapshots";
import { normalizeTimeZone } from "../../src/lib/kpi-recurrence";
import { normalizePersonName } from "../../src/lib/person-name";
import { mergePersonnelRequestMetrics, type PersonnelCombinedMetricCard } from "../../src/lib/task-personnel-metrics";

const PROCEDURAL = [
  "REQUEST_FOR_PAYMENT",
  "ITEM_REQUISITION_SLIP",
  "FUND_TRANSFER_REQUEST",
  "AUTHORITY_TO_CONDUCT_ACTIVITY",
] as const;

type Bucket = { closed: number; pending: number };
type WorkingDayInterval = { start: Date; end: Date };

function workingDayIntervals(from: Date, to: Date, timeZone: string): WorkingDayInterval[] {
  const zone = normalizeTimeZone(timeZone);
  const fromYmd = DateTime.fromJSDate(from, { zone }).toISODate()!;
  const toYmd = DateTime.fromJSDate(to, { zone }).toISODate()!;
  return enumerateYmdDaysInRange(fromYmd, toYmd, zone).map((ymd) => {
    const dt = DateTime.fromISO(ymd, { zone });
    return { start: dt.startOf("day").toJSDate(), end: dt.endOf("day").toJSDate() };
  });
}

function inWorkingDays(d: Date | null | undefined, intervals: WorkingDayInterval[]): boolean {
  if (!d) return false;
  const t = d.getTime();
  return intervals.some((i) => t >= i.start.getTime() && t <= i.end.getTime());
}

function bump(map: Map<string, Bucket>, id: string, field: keyof Bucket) {
  const cur = map.get(id) ?? { closed: 0, pending: 0 };
  cur[field] += 1;
  map.set(id, cur);
}

function efficiency1(closed: number, pending: number): number {
  return helpdeskSupportPercent(closed, pending) ?? 0;
}

function efficiencyRound(closed: number, pending: number): number {
  const total = closed + pending;
  return total > 0 ? Math.round((closed / total) * 100) : 0;
}

function metricMap(rows: PersonnelTicketMetric[]): Map<string, PersonnelTicketMetric> {
  return new Map(rows.map((r) => [r.id, r]));
}

function compareBucket(
  label: string,
  expected: Map<string, Bucket>,
  metrics: PersonnelTicketMetric[],
  names: Map<string, string>,
): { ok: boolean; mismatches: Array<Record<string, unknown>> } {
  const got = metricMap(metrics);
  const mismatches: Array<Record<string, unknown>> = [];
  const ids = new Set([...expected.keys(), ...got.keys()]);
  for (const id of ids) {
    const e = expected.get(id) ?? { closed: 0, pending: 0 };
    const g = got.get(id);
    const gClosed = g?.closed ?? 0;
    const gPending = g?.pending ?? 0;
    if (e.closed === 0 && e.pending === 0 && !g) continue;
    if (e.closed !== gClosed || e.pending !== gPending) {
      mismatches.push({
        label,
        agentId: id,
        name: names.get(id) ?? g?.name ?? "?",
        expectedClosed: e.closed,
        expectedPending: e.pending,
        metricsClosed: gClosed,
        metricsPending: gPending,
        expectedEff: efficiency1(e.closed, e.pending),
        metricsEff: g?.efficiency ?? 0,
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function accumulateByName(
  rows: PersonnelTicketMetric[],
): Map<string, { id: string; name: string; closed: number; pending: number }> {
  const map = new Map<string, { id: string; name: string; closed: number; pending: number }>();
  for (const row of rows) {
    const key = normalizePersonName(row.name);
    if (!key) continue;
    const cur = map.get(key) ?? { id: row.id, name: row.name.trim(), closed: 0, pending: 0 };
    cur.closed += row.closed;
    cur.pending += row.pending;
    if (row.id) cur.id = row.id;
    map.set(key, cur);
  }
  return map;
}

async function main() {
  const tz = snapshotTimeZoneForTaskMetrics(process.env.TZ || process.env.KPI_SNAPSHOT_TZ || "Asia/Manila");
  const zone = normalizeTimeZone(tz);
  const now = DateTime.now().setZone(zone);
  const fromYmd = process.env.FROM ?? now.startOf("month").toISODate()!;
  const toYmd = process.env.TO ?? now.toISODate()!;
  const from = DateTime.fromISO(fromYmd, { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO(toYmd, { zone }).endOf("day").toJSDate();
  const intervals = workingDayIntervals(from, to, tz);

  const metrics = await computeTaskMetrics(
    { from, to },
    {},
    "MONTHLY",
    { timeZone: tz, taskType: "requests" },
  );

  const tickets = await prisma.ticket.findMany({
    select: {
      id: true,
      ticketNumber: true,
      requestType: true,
      status: true,
      closedAt: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      itemRequisitionApprovalMeta: true,
      fundTransferApprovalMeta: true,
      acaApprovalMeta: true,
    },
  });

  const assigneeClosed = new Map<string, Bucket>();
  const assigneePending = new Map<string, Bucket>();
  const rfpAcct = new Map<string, Bucket>();
  const rfpFin = new Map<string, Bucket>();
  const irs = new Map<string, Bucket>();
  const ftr = new Map<string, Bucket>();
  const aca = new Map<string, Bucket>();

  let proceduralOnAssigneeClosed = 0;
  let proceduralOnAssigneePending = 0;
  let companyClosed = 0;
  let companyOpenInPeriod = 0;

  const openPipeline = new Set<string>(OPEN_PIPELINE_STATUSES);
  const activeStatuses = new Set<string>(ACTIVE_REQUEST_STATUSES);

  for (const t of tickets) {
    const isProcedural = (PROCEDURAL as readonly string[]).includes(t.requestType ?? "");

    // Company REQUEST SUPPORT (live): closed on working day in range; open = non-CLOSED created<=end and (closed null or closed>=start)
    if (t.closedAt && inWorkingDays(t.closedAt, intervals)) {
      companyClosed += 1;
    }
    if (t.status !== "CLOSED") {
      const createdOk = true; // open-in-period uses createdAt <= range.end — approximate via all non-closed that overlap
      // Match loadLiveHelpdeskTaskMetricCounts semantics as closely as possible with available fields:
      // openTicketsInPeriod: status ≠ CLOSED, createdAt ≤ range.end, closedAt null OR closedAt ≥ range.start
      // We didn't select createdAt — fetch-level recount for company is secondary; use metrics payload.
      void createdOk;
    }

    if (!isProcedural) {
      if (t.assignedAgentId && t.closedAt && inWorkingDays(t.closedAt, intervals)) {
        bump(assigneeClosed, t.assignedAgentId, "closed");
      }
      if (t.assignedAgentId && openPipeline.has(t.status)) {
        bump(assigneePending, t.assignedAgentId, "pending");
      }
    } else {
      // Procedural must NOT credit board assignee in default ticket metrics
      if (t.assignedAgentId && t.closedAt && inWorkingDays(t.closedAt, intervals)) {
        proceduralOnAssigneeClosed += 1;
      }
      if (t.assignedAgentId && openPipeline.has(t.status)) {
        proceduralOnAssigneePending += 1;
      }
    }

    if (t.requestType === "REQUEST_FOR_PAYMENT" && t.paymentApprovalMeta != null) {
      const meta = parsePaymentApprovalMeta(t.paymentApprovalMeta);
      if (meta) {
        const closedInRange = Boolean(t.closedAt && inWorkingDays(t.closedAt, intervals));
        // Role seats only — never board assignee / Approved By fallback.
        if (closedInRange && meta.completed.APPROVED_BY_ACCOUNTING && meta.accountingAgentId) {
          bump(rfpAcct, meta.accountingAgentId, "closed");
        }
        if (closedInRange && meta.completed.APPROVED_BY_FINANCE && meta.financeAgentId) {
          bump(rfpFin, meta.financeAgentId, "closed");
        }
        if (meta.proceduralStep === "APPROVED_BY_ACCOUNTING" && meta.accountingAgentId) {
          bump(rfpAcct, meta.accountingAgentId, "pending");
        }
        if (meta.proceduralStep === "APPROVED_BY_FINANCE" && meta.financeAgentId) {
          bump(rfpFin, meta.financeAgentId, "pending");
        }
      }
    }

    if (t.requestType === "ITEM_REQUISITION_SLIP" && t.itemRequisitionApprovalMeta != null) {
      const meta = parseItemRequisitionApprovalMeta(t.itemRequisitionApprovalMeta);
      if (meta) {
        const closedInRange = Boolean(t.closedAt && inWorkingDays(t.closedAt, intervals));
        if (closedInRange && meta.completed.CANVASSED_BY && meta.canvassedByAgentId) {
          bump(irs, meta.canvassedByAgentId, "closed");
        }
        if (meta.proceduralStep === "CANVASSED_BY" && meta.canvassedByAgentId) {
          bump(irs, meta.canvassedByAgentId, "pending");
        }
      }
    }

    if (t.requestType === "FUND_TRANSFER_REQUEST" && t.fundTransferApprovalMeta != null) {
      const meta = parseFundTransferApprovalMeta(t.fundTransferApprovalMeta);
      if (meta) {
        const closedInRange = Boolean(t.closedAt && inWorkingDays(t.closedAt, intervals));
        if (closedInRange && meta.completed.PREPARED_BY && meta.preparedByAgentId) {
          bump(ftr, meta.preparedByAgentId, "closed");
        }
        if (meta.proceduralStep === "PREPARED_BY" && meta.preparedByAgentId) {
          bump(ftr, meta.preparedByAgentId, "pending");
        }
      }
    }

    if (t.requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY" && t.acaApprovalMeta != null) {
      const meta = parseAcaApprovalMeta(t.acaApprovalMeta);
      if (meta) {
        const level = meta.levels.find((l) => l.key === "SUBMITTED_BY");
        const id = level?.agentId?.trim() || null;
        if (id) {
          if (t.closedAt && inWorkingDays(t.closedAt, intervals)) {
            bump(aca, id, "closed");
          } else if (!t.closedAt && activeStatuses.has(t.status)) {
            bump(aca, id, "pending");
          }
        }
      }
    }
  }

  // Merge assignee closed+pending maps
  const assigneeExpected = new Map<string, Bucket>();
  for (const [id, b] of assigneeClosed) {
    assigneeExpected.set(id, { ...b });
  }
  for (const [id, b] of assigneePending) {
    const cur = assigneeExpected.get(id) ?? { closed: 0, pending: 0 };
    cur.pending = b.pending;
    assigneeExpected.set(id, cur);
  }

  const agentIds = [
    ...new Set([
      ...assigneeExpected.keys(),
      ...rfpAcct.keys(),
      ...rfpFin.keys(),
      ...irs.keys(),
      ...ftr.keys(),
      ...aca.keys(),
      ...metrics.personnelTicketMetrics.map((m) => m.id),
      ...metrics.personnelRfpAccountingMetrics.map((m) => m.id),
      ...metrics.personnelRfpFinanceMetrics.map((m) => m.id),
      ...metrics.personnelIrsCanvassMetrics.map((m) => m.id),
      ...metrics.personnelFtrPreparedMetrics.map((m) => m.id),
      ...metrics.personnelAcaSubmittedMetrics.map((m) => m.id),
    ]),
  ];
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const names = new Map(agents.map((a) => [a.id, a.name]));

  const checks = [
    compareBucket("assigneeTickets", assigneeExpected, metrics.personnelTicketMetrics, names),
    compareBucket("rfpAccounting", rfpAcct, metrics.personnelRfpAccountingMetrics, names),
    compareBucket("rfpFinance", rfpFin, metrics.personnelRfpFinanceMetrics, names),
    compareBucket("irsCanvass", irs, metrics.personnelIrsCanvassMetrics, names),
    compareBucket("ftrPrepared", ftr, metrics.personnelFtrPreparedMetrics, names),
    compareBucket("acaSubmitted", aca, metrics.personnelAcaSubmittedMetrics, names),
  ];

  // Build merged Requests KPI for every user (Insights rollup)
  const byNameTickets = accumulateByName(metrics.personnelTicketMetrics);
  const byNameRfpA = accumulateByName(metrics.personnelRfpAccountingMetrics);
  const byNameRfpF = accumulateByName(metrics.personnelRfpFinanceMetrics);
  const byNameIrs = accumulateByName(metrics.personnelIrsCanvassMetrics);
  const byNameFtr = accumulateByName(metrics.personnelFtrPreparedMetrics);
  const byNameAca = accumulateByName(metrics.personnelAcaSubmittedMetrics);
  const allNames = new Set([
    ...byNameTickets.keys(),
    ...byNameRfpA.keys(),
    ...byNameRfpF.keys(),
    ...byNameIrs.keys(),
    ...byNameFtr.keys(),
    ...byNameAca.keys(),
  ]);

  const users: Array<Record<string, unknown>> = [];
  for (const key of [...allNames].sort()) {
    const t = byNameTickets.get(key);
    const ra = byNameRfpA.get(key);
    const rf = byNameRfpF.get(key);
    const i = byNameIrs.get(key);
    const f = byNameFtr.get(key);
    const a = byNameAca.get(key);
    const card: PersonnelCombinedMetricCard = {
      id: t?.id ?? ra?.id ?? rf?.id ?? i?.id ?? f?.id ?? a?.id ?? key,
      name: t?.name ?? ra?.name ?? rf?.name ?? i?.name ?? f?.name ?? a?.name ?? key,
      role: "Assignee",
      tickets: t
        ? { closed: t.closed, pending: t.pending, efficiency: efficiencyRound(t.closed, t.pending) }
        : null,
      rfpRequestor: null,
      rfpAccounting: ra
        ? { closed: ra.closed, pending: ra.pending, efficiency: efficiencyRound(ra.closed, ra.pending) }
        : null,
      rfpFinance: rf
        ? { closed: rf.closed, pending: rf.pending, efficiency: efficiencyRound(rf.closed, rf.pending) }
        : null,
      irsCanvass: i
        ? { closed: i.closed, pending: i.pending, efficiency: efficiencyRound(i.closed, i.pending) }
        : null,
      ftrPrepared: f
        ? { closed: f.closed, pending: f.pending, efficiency: efficiencyRound(f.closed, f.pending) }
        : null,
      acaSubmitted: a
        ? { closed: a.closed, pending: a.pending, efficiency: efficiencyRound(a.closed, a.pending) }
        : null,
      tasks: null,
    };
    const requests = mergePersonnelRequestMetrics(card);
    users.push({
      name: card.name,
      id: card.id,
      requests,
      buckets: {
        tickets: card.tickets,
        rfpAccounting: card.rfpAccounting,
        rfpFinance: card.rfpFinance,
        irsCanvass: card.irsCanvass,
        ftrPrepared: card.ftrPrepared,
        acaSubmitted: card.acaSubmitted,
      },
    });
  }

  users.sort((a, b) => {
    const ae = (a.requests as { efficiency: number } | null)?.efficiency ?? -1;
    const be = (b.requests as { efficiency: number } | null)?.efficiency ?? -1;
    return be - ae || String(a.name).localeCompare(String(b.name));
  });

  const allMismatches = checks.flatMap((c) => c.mismatches);
  const helpdesk = metrics.taskMetricsHelpdesk;
  const expectedCompanyPct = helpdeskSupportPercent(
    helpdesk.closedCount,
    helpdesk.openTicketsInPeriod,
  );

  const report = {
    range: {
      from: fromYmd,
      to: toYmd,
      tz,
      workingDays: intervals.length,
      sundaysExcluded: true,
    },
    companyRequestSupport: {
      closedInRange: helpdesk.closedCount,
      openTicketsInPeriod: helpdesk.openTicketsInPeriod,
      requestsInRange: helpdesk.requestsInRange,
      openBacklog: helpdesk.openBacklog,
      percent: helpdesk.percent,
      formulaOk: helpdesk.percent === expectedCompanyPct,
      note: "Live+CSV blend may apply when unscoped; percent uses helpdeskSupportPercent (1 decimal).",
    },
    creditRules: {
      assignee: "Issue/Concern, Job Order, other non-procedural → assignedAgentId",
      excludedFromAssignee: PROCEDURAL,
      rfp: "Accounting / Finance agents (not requestor)",
      irs: "Canvassed By",
      ftr: "Prepared By",
      aca: "Submitted By",
      pendingStatuses: OPEN_PIPELINE_STATUSES,
      closedWindow: "closedAt on Mon–Sat working day in range",
    },
    proceduralNotDoubleCountedOnAssignee: {
      proceduralTicketsClosedInRangeWithAssignee: proceduralOnAssigneeClosed,
      proceduralTicketsPendingWithAssignee: proceduralOnAssigneePending,
      note: "These must NOT appear in personnelTicketMetrics (role KPIs only).",
    },
    bucketChecks: Object.fromEntries(
      checks.map((c, idx) => {
        const labels = [
          "assigneeTickets",
          "rfpAccounting",
          "rfpFinance",
          "irsCanvass",
          "ftrPrepared",
          "acaSubmitted",
        ];
        return [
          labels[idx],
          {
            ok: c.ok,
            mismatchCount: c.mismatches.length,
            metricsUsers: [
              metrics.personnelTicketMetrics,
              metrics.personnelRfpAccountingMetrics,
              metrics.personnelRfpFinanceMetrics,
              metrics.personnelIrsCanvassMetrics,
              metrics.personnelFtrPreparedMetrics,
              metrics.personnelAcaSubmittedMetrics,
            ][idx].length,
          },
        ];
      }),
    ),
    mismatches: allMismatches,
    userCount: users.length,
    users,
    summary: {
      allBucketsOk: allMismatches.length === 0,
      companyFormulaOk: helpdesk.percent === expectedCompanyPct && expectedCompanyPct != null,
      usersWithRequests: users.filter((u) => u.requests != null).length,
      totalClosed: users.reduce(
        (s, u) => s + ((u.requests as { closed: number } | null)?.closed ?? 0),
        0,
      ),
      totalPending: users.reduce(
        (s, u) => s + ((u.requests as { pending: number } | null)?.pending ?? 0),
        0,
      ),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (allMismatches.length > 0 || helpdesk.percent !== expectedCompanyPct) {
    process.exitCode = 1;
  }

  void Prisma;
  void companyOpenInPeriod;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
