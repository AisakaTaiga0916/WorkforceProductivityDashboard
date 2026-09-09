/**
 * Repair Huerte (1682) and Lagang (1709): merge leftover LEGACY_CONFLICT
 * portals and duplicate agents onto the HRIS-linked ACTIVE accounts.
 */
import { mergeAgentOwnership } from "../../src/lib/reconcile-duplicate-agents";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../../src/lib/prisma";

const TARGETS = [
  {
    sourceUserId: 1682n,
    canonicalPortalId: "d1f435b7-7c5d-45df-8131-46f2e9922196",
    legacyPortalId: "30269d2d-fd77-4f7b-8ebc-fdbcaceb39fd",
    extraStaleAgentIds: ["cmrbdhqpp011q11jondhfojyf"], // huertejobi@gmail.com
  },
  {
    sourceUserId: 1709n,
    canonicalPortalId: "8946715f-e43c-470d-a102-0907a6f48758",
    legacyPortalId: "f4e084a6-626a-4104-abfb-2b8cb71204b7",
    extraStaleAgentIds: [] as string[],
  },
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const summary: unknown[] = [];

  for (const target of TARGETS) {
    const canonical = await prismaPrimary.portalAccount.findUniqueOrThrow({
      where: { id: target.canonicalPortalId },
    });
    const legacy = await prismaPrimary.portalAccount.findUnique({
      where: { id: target.legacyPortalId },
    });
    const canonicalAgent = await prismaPrimary.agent.findFirst({
      where: { email: { equals: canonical.email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
    if (!canonicalAgent) {
      throw new Error(`No agent for ${canonical.email}`);
    }

    const staleIds = new Set(target.extraStaleAgentIds);
    if (legacy) {
      const legacyAgents = await prismaPrimary.agent.findMany({
        where: {
          OR: [
            { email: { equals: legacy.email, mode: "insensitive" } },
            { name: { equals: legacy.name, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      for (const a of legacyAgents) staleIds.add(a.id);
    }
    staleIds.delete(canonicalAgent.id);

    const moved: unknown[] = [];
    for (const staleId of staleIds) {
      const merged = await mergeAgentOwnership(
        staleId,
        { id: canonicalAgent.id, name: canonical.name },
        { dryRun: !apply },
      );
      moved.push({ staleId, ...merged });
      if (apply) {
        const still =
          (await prismaPrimary.ticket.count({ where: { assignedAgentId: staleId } })) +
          (await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: staleId } })) +
          (await prismaPrimary.taskItem.count({ where: { assignedAgentId: staleId } }));
        if (still === 0) {
          await prismaPrimary.agent.delete({ where: { id: staleId } }).catch(() => null);
        }
      }
    }

    let actionRequests = 0;
    if (legacy) {
      actionRequests = apply
        ? (
            await prismaPrimary.accountActionRequest.updateMany({
              where: { portalAccountId: legacy.id },
              data: { portalAccountId: canonical.id },
            })
          ).count
        : await prismaPrimary.accountActionRequest.count({
            where: { portalAccountId: legacy.id },
          });

      if (apply) {
        if (legacy.staffDesignatedCompanyId && !canonical.staffDesignatedCompanyId) {
          await prismaPrimary.portalAccount.update({
            where: { id: canonical.id },
            data: { staffDesignatedCompanyId: legacy.staffDesignatedCompanyId },
          });
        }
        await prismaPrimary.portalMergeMapping.upsert({
          where: { portalAccountId: canonical.id },
          create: {
            portalAccountId: canonical.id,
            mergedSourceUserId: target.sourceUserId,
            legacyPortalEmail: legacy.email,
            legacyUsername: legacy.username,
            lastSyncedAt: new Date(),
          },
          update: {
            legacyPortalEmail: legacy.email,
            lastSyncedAt: new Date(),
          },
        });
        await prismaPrimary.portalAccount.update({
          where: { id: legacy.id },
          data: {
            accountStatus: "LEGACY_MERGED",
            username: null,
          },
        });
        await prismaAuth.user.updateMany({
          where: { portalAccountId: legacy.id },
          data: { portalAccountId: null },
        });
      }
    }

    summary.push({
      name: canonical.name,
      email: canonical.email,
      username: canonical.username,
      mergedSourceUserId: String(target.sourceUserId),
      canonicalPortalId: canonical.id,
      canonicalAgentId: canonicalAgent.id,
      legacyPortalId: legacy?.id ?? null,
      legacyStatusBefore: legacy?.accountStatus ?? null,
      staleAgentIds: [...staleIds],
      moved,
      actionRequests,
    });
  }

  console.log(apply ? "=== Applied ===" : "=== Dry run (pass --apply to write) ===");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
    await prismaSecondary.$disconnect();
  });
