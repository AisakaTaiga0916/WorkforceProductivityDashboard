import { Prisma } from "@prisma/client/primary";
import { prismaPrimary } from "../../src/lib/prisma";

const HUERTE_WORK = "cmpdly428005csdp4fpevnlmw";
const HUERTE_GMAIL = "cmrbdhqpp011q11jondhfojyf";
const LAGANG = "cmrpt1qos00174xsu7wlo0zqu";

async function counts(id: string) {
  const [tickets, kpis, tasks] = await Promise.all([
    prismaPrimary.ticket.count({ where: { assignedAgentId: id } }),
    prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: id } }),
    prismaPrimary.taskItem.count({ where: { assignedAgentId: id } }),
  ]);
  const sub = await prismaPrimary.kpiMaintenance.count({
    where: { subKpis: { string_contains: id } as Prisma.JsonFilter },
  }).catch(async () => {
    const rows = await prismaPrimary.kpiMaintenance.findMany({
      where: { subKpis: { not: Prisma.DbNull } },
      select: { id: true, subKpis: true },
    });
    return rows.filter((r) => JSON.stringify(r.subKpis).includes(id)).length;
  });
  return { tickets, kpis, tasks, subKpis: sub };
}

async function main() {
  const out = {
    huerteWork: await counts(HUERTE_WORK),
    huerteGmail: await counts(HUERTE_GMAIL),
    lagang: await counts(LAGANG),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => prismaPrimary.$disconnect());
