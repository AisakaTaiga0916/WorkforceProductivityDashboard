/**
 * After importing restore data: align agent emails with portal staff emails (by name)
 * and set staffDesignatedCompanyId to General Queue for staff roles.
 *
 * Usage: npx tsx scripts/link-portal-staff-after-import.ts
 */
import { normalizePersonName } from "../src/lib/person-name";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const generalQueue = await prismaPrimary.team.findFirst({
    where: { name: "General Queue" },
    select: { id: true },
  });
  if (!generalQueue) {
    console.warn("[link-portal-staff] General Queue team not found");
    return;
  }

  const portals = await prismaPrimary.portalAccount.findMany({
    where: { role: { in: ["Admin", "Personnel", "SuperAdmin"] } },
    select: { id: true, email: true, name: true, role: true, staffDesignatedCompanyId: true },
  });

  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, email: true, name: true },
  });

  let agentsUpdated = 0;
  let portalsUpdated = 0;

  for (const portal of portals) {
    const portalEmail = portal.email.trim().toLowerCase();
    const portalNameKey = normalizePersonName(portal.name);

    const agent =
      agents.find((a) => a.email.trim().toLowerCase() === portalEmail) ??
      agents.find((a) => normalizePersonName(a.name) === portalNameKey);

    if (agent && agent.email.trim().toLowerCase() !== portalEmail) {
      await prismaPrimary.agent.update({
        where: { id: agent.id },
        data: { email: portalEmail },
      });
      agentsUpdated++;
    }

    if (!portal.staffDesignatedCompanyId) {
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: { staffDesignatedCompanyId: generalQueue.id },
      });
      portalsUpdated++;
    }
  }

  console.log(
    `[link-portal-staff] portals=${portals.length} agentEmailsUpdated=${agentsUpdated} staffCompanySet=${portalsUpdated}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
