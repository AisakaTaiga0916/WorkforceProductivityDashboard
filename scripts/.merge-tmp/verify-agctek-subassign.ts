import { prisma } from "@/lib/prisma";
import {
  isTimelineProjectKpi,
  itProjectAllItems,
  parseItProjectSubKpis,
  setItProjectSubKpiAssignee,
} from "@/lib/it-project-subkpis";
import { collectChecklistProgressItems } from "@/lib/kpi-subkpis";

async function main() {
  const row = await prisma.kpiMaintenance.findFirst({
    where: { id: "cmtid37hs003sj1nym8fa2v4r" },
    select: { id: true, title: true, mainTask: true, subKpis: true },
  });
  if (!row) {
    console.log("not found");
    return;
  }
  const timeline = isTimelineProjectKpi(row.title, row.subKpis);
  const viaTitleOnly = collectChecklistProgressItems(row.subKpis, row.mainTask ?? row.title);
  const viaTimeline = itProjectAllItems(parseItProjectSubKpis(row.subKpis));
  console.log(
    JSON.stringify(
      {
        title: row.title,
        timeline,
        oldPathItemCount: viaTitleOnly.length,
        oldPathTitles: viaTitleOnly.map((i) => i.title),
        newPathItemCount: viaTimeline.length,
        newPathTitles: viaTimeline.map((i) => i.title),
      },
      null,
      2,
    ),
  );
  const first = viaTimeline[0]!;
  const next = setItProjectSubKpiAssignee(row.subKpis, first.id, {
    id: "dry-run-agent",
    name: "Dry Run",
  });
  const after = itProjectAllItems(parseItProjectSubKpis(next)).find((i) => i.id === first.id);
  console.log(
    JSON.stringify(
      {
        dryRunAssignee: { id: after?.assignedAgentId, name: after?.assignedAgentName, status: after?.projectStatus },
        note: "dry-run only — not written to DB",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
