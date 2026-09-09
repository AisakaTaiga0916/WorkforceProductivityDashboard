import { prisma } from "@/lib/prisma";
import { isItProjectEnvelope } from "@/lib/it-project-subkpis";

async function main() {
  const rows = await prisma.kpiMaintenance.findMany({
    where: {
      OR: [
        { mainTask: { contains: "AGCTEK", mode: "insensitive" } },
        { mainTask: { contains: "ERP", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      title: true,
      mainTask: true,
      enableSubtaskAssignees: true,
      assignedAgentId: true,
      subKpis: true,
    },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });
  for (const r of rows) {
    const sk = r.subKpis as Record<string, unknown> | null;
    const phases = Array.isArray(sk?.phases) ? sk.phases : [];
    const firstPhase = phases[0] as { name?: string; items?: unknown[] } | undefined;
    console.log(
      JSON.stringify(
        {
          id: r.id,
          title: r.title,
          mainTask: r.mainTask,
          enableSubtaskAssignees: r.enableSubtaskAssignees,
          assignedAgentId: r.assignedAgentId,
          isItEnvelope: isItProjectEnvelope(r.subKpis),
          kind: sk && typeof sk === "object" ? sk.kind : null,
          phaseCount: phases.length,
          firstPhaseName: firstPhase?.name ?? null,
          firstItemTitles: Array.isArray(firstPhase?.items)
            ? firstPhase!.items!.slice(0, 5).map((it) =>
                it && typeof it === "object" && "title" in it
                  ? String((it as { title?: string }).title)
                  : "?",
              )
            : [],
        },
        null,
        2,
      ),
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
