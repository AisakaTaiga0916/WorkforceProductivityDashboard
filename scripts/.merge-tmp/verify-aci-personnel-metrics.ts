/**
 * Verify Task Metrics / Reports personnel view for company ACI.
 *
 * Cross-checks:
 * 1) Roster membership via loadAgentIdsForCompanyTeam(ACI)
 * 2) Live computeTaskMetrics scoped to those agent ids (Insights Task Metrics API)
 * 3) Merged efficiency personnel rows with companyName = ACI (Reports / personnel cards)
 * 4) Request role credit only for explicit seats (no Approver fallback)
 *
 * Run: npx tsx scripts/.merge-tmp/verify-aci-personnel-metrics.ts
 */
import { DateTime } from "luxon";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { prisma } from "../../src/lib/prisma";
import { resolveSecondaryWriteUrl } from "../../src/lib/prisma-secondary-write";
import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/lib/kpis";
import { loadAgentIdsForCompanyTeam } from "../../src/lib/staff-company-scope";
import { resolveRosterCompanyName } from "../../src/lib/hris-company-aliases";
import { normalizePersonName } from "../../src/lib/person-name";
import {
  aggregatePersonnelTaskMetrics,
  applyDelayPenaltiesToPersonnelTasks,
  attachPersonnelRequestRoleMetrics,
  mergePersonnelMetricCards,
  mergePersonnelRequestMetrics,
  combinedPersonnelEfficiency,
} from "../../src/lib/task-personnel-metrics";

async function main() {
  const aciTeam = await prisma.team.findFirst({
    where: { name: { equals: "ACI", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!aciTeam) {
    console.error("ACI team not found in primary roster");
    process.exitCode = 1;
    return;
  }

  const agentIds = await loadAgentIdsForCompanyTeam(aciTeam.id);
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const aciNameKeys = new Set(agents.map((a) => normalizePersonName(a.name)).filter(Boolean));

  const range = parseKpiRangeFromQuery(null, null);
  const metrics = await computeTaskMetrics(
    range,
    { assignedAgentIds: agentIds.length > 0 ? agentIds : ["__none__"] },
    "MONTHLY",
  );

  const taskRows = applyDelayPenaltiesToPersonnelTasks(
    aggregatePersonnelTaskMetrics(metrics.taskChecklistPillars),
    metrics.personnelDelayPenalties,
  );
  const cards = attachPersonnelRequestRoleMetrics(
    mergePersonnelMetricCards(taskRows, metrics.personnelTicketMetrics),
    {
      rfpAccounting: metrics.personnelRfpAccountingMetrics,
      rfpFinance: metrics.personnelRfpFinanceMetrics,
      irsCanvass: metrics.personnelIrsCanvassMetrics,
      ftrPrepared: metrics.personnelFtrPreparedMetrics,
      acaSubmitted: metrics.personnelAcaSubmittedMetrics,
    },
  );

  const liveCards = cards.map((card) => {
    const requests = mergePersonnelRequestMetrics(card);
    return {
      id: card.id,
      name: card.name,
      inAciRoster: aciNameKeys.has(normalizePersonName(card.name)) || agentById.has(card.id),
      requests,
      tasks: card.tasks
        ? {
            closed: card.tasks.closed,
            pending: card.tasks.pending,
            efficiency: card.tasks.efficiency,
            penalty: card.tasks.penaltyDeduction ?? 0,
          }
        : null,
      overall: combinedPersonnelEfficiency(card),
      buckets: {
        tickets: card.tickets,
        rfpAccounting: card.rfpAccounting,
        rfpFinance: card.rfpFinance,
        irsCanvass: card.irsCanvass,
        ftrPrepared: card.ftrPrepared,
        acaSubmitted: card.acaSubmitted,
      },
    };
  });

  const outsidersLive = liveCards.filter((c) => !c.inAciRoster);
  const liveWithActivity = liveCards.filter(
    (c) => c.requests != null || c.tasks != null,
  );

  // Merged personnel view (Reports / Insights personnel cards source)
  const writeUrl = resolveSecondaryWriteUrl();
  const db = new PrismaClientSecondary({ datasources: { db: { url: writeUrl } } });
  const periodKey = DateTime.now().setZone("Asia/Manila").toFormat("yyyy-MM");
  let mergedAci: Array<{
    name: string;
    companyName: string | null;
    ticketsClosed: number;
    ticketsPending: number;
    ticketEfficiency: number | null;
    taskEfficiency: number | null;
    overallEfficiency: number;
  }> = [];
  try {
    const rows = await db.mergedUserEfficiencyBreakdown.findMany({
      where: { periodKey, frequency: "MONTHLY" },
      orderBy: [{ overallEfficiency: "desc" }, { displayName: "asc" }],
      include: { user: { select: { name: true, companyName: true } } },
    });
    mergedAci = rows
      .map((r) => {
        const companyName = r.user?.companyName ?? null;
        const canonical = resolveRosterCompanyName(companyName) ?? companyName?.trim() ?? "";
        return {
          name: r.user?.name?.trim() || r.displayName,
          companyName,
          canonicalCompany: canonical,
          ticketsClosed: Number((r as { ticketsClosed?: number }).ticketsClosed ?? 0),
          ticketsPending: Number((r as { ticketsPending?: number }).ticketsPending ?? 0),
          ticketEfficiency: r.ticketEfficiency != null ? Number(r.ticketEfficiency) : null,
          taskEfficiency: r.taskEfficiency != null ? Number(r.taskEfficiency) : null,
          overallEfficiency: Number(r.overallEfficiency),
        };
      })
      .filter((r) => r.canonicalCompany.toLowerCase() === "aci");
  } finally {
    await db.$disconnect();
  }

  // Cross-check: merged ACI names should map to roster (or be explained)
  const mergedOutsideRoster = mergedAci.filter(
    (r) => !aciNameKeys.has(normalizePersonName(r.name)),
  );
  const rosterWithoutMerged = agents
    .filter((a) => !mergedAci.some((m) => normalizePersonName(m.name) === normalizePersonName(a.name)))
    .map((a) => a.name);

  // Approver false-credit check: RFP accounting/finance rows must have explicit seat agents in ACI
  const roleOnlyApproverSuspects = liveWithActivity.filter((c) => {
    const onlyRole =
      !c.buckets.tickets &&
      (c.buckets.rfpAccounting || c.buckets.rfpFinance) &&
      !c.buckets.irsCanvass &&
      !c.buckets.ftrPrepared &&
      !c.buckets.acaSubmitted &&
      !c.tasks;
    return onlyRole && (c.requests?.closed === 0 || c.requests?.efficiency === 0);
  });

  const report = {
    company: { id: aciTeam.id, name: aciTeam.name },
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      periodKey,
    },
    roster: {
      agentCount: agents.length,
      agents: agents.map((a) => ({ id: a.id, name: a.name, email: a.email })),
    },
    liveTaskMetricsScoped: {
      cardCount: liveWithActivity.length,
      outsiderCount: outsidersLive.length,
      outsiders: outsidersLive.map((c) => ({ name: c.name, id: c.id, requests: c.requests, tasks: c.tasks })),
      ok: outsidersLive.length === 0,
      personnel: liveWithActivity.map((c) => ({
        name: c.name,
        inAciRoster: c.inAciRoster,
        requests: c.requests,
        tasks: c.tasks,
        overall: c.overall,
        activeBuckets: Object.fromEntries(
          Object.entries(c.buckets).filter(([, v]) => v != null),
        ),
      })),
    },
    mergedPersonnelView: {
      periodKey,
      frequency: "MONTHLY",
      rowCount: mergedAci.length,
      outsideRosterCount: mergedOutsideRoster.length,
      outsideRoster: mergedOutsideRoster.map((r) => ({
        name: r.name,
        companyName: r.companyName,
      })),
      rosterMissingFromMerged: rosterWithoutMerged,
      ok: mergedOutsideRoster.length === 0,
      personnel: mergedAci.map((r) => ({
        name: r.name,
        companyName: r.companyName,
        ticketsClosed: r.ticketsClosed,
        ticketsPending: r.ticketsPending,
        ticketEfficiency: r.ticketEfficiency,
        taskEfficiency: r.taskEfficiency,
        overallEfficiency: r.overallEfficiency,
        inAciRoster: aciNameKeys.has(normalizePersonName(r.name)),
      })),
    },
    roleCreditNotes: {
      approverOnlySuspectsOnLive: roleOnlyApproverSuspects.map((c) => c.name),
      note: "RFP/IRS/FTR credit requires explicit role seats; Approvers must not appear from board-assignee fallback.",
    },
    summary: {
      liveScopedOk: outsidersLive.length === 0,
      mergedCompanyFilterOk: mergedOutsideRoster.length === 0,
      aciRosterSize: agents.length,
      livePersonnelWithActivity: liveWithActivity.length,
      mergedAciRows: mergedAci.length,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.summary.liveScopedOk || !report.summary.mergedCompanyFilterOk) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
