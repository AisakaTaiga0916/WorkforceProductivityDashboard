/**
 * Repair Reginald Malubay: merge LEGACY_CONFLICT agent/portal onto HRIS ACTIVE.
 *
 * Legacy agent: cmrpyuvty000111lydrm8c8qk (Reginald Malubay)
 * HRIS agent:   cmrpr1c8u000xj1cin55odq2m (Malubay, Reginald Araña) — merged #1660
 *
 * Usage:
 *   npx tsx scripts/.merge-tmp/repair-malubay.ts
 *   npx tsx scripts/.merge-tmp/repair-malubay.ts --apply
 */
import { mergeAgentOwnership } from "../../src/lib/reconcile-duplicate-agents";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../../src/lib/prisma";

const SOURCE_USER_ID = 1660n;
const LEGACY_AGENT_ID = "cmrpyuvty000111lydrm8c8qk";
const CANONICAL_AGENT_ID = "cmrpr1c8u000xj1cin55odq2m";

async function main() {
  const apply = process.argv.includes("--apply");

  const canonicalAgent = await prismaPrimary.agent.findUniqueOrThrow({
    where: { id: CANONICAL_AGENT_ID },
    select: { id: true, name: true, email: true },
  });
  const legacyAgent = await prismaPrimary.agent.findUnique({
    where: { id: LEGACY_AGENT_ID },
    select: { id: true, name: true, email: true },
  });
  if (!legacyAgent) {
    console.log("Legacy agent already gone; nothing to do.");
    return;
  }

  const canonicalPortal = await prismaPrimary.portalAccount.findFirst({
    where: {
      OR: [
        { email: { equals: canonicalAgent.email, mode: "insensitive" } },
        { mergedSourceUserId: SOURCE_USER_ID },
      ],
      accountStatus: { not: "LEGACY_CONFLICT" },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!canonicalPortal) {
    throw new Error(`No ACTIVE portal for canonical agent ${canonicalAgent.email}`);
  }

  const legacyPortal =
    (await prismaPrimary.portalAccount.findFirst({
      where: {
        email: { equals: legacyAgent.email, mode: "insensitive" },
        id: { not: canonicalPortal.id },
      },
    })) ??
    (await prismaPrimary.portalAccount.findFirst({
      where: {
        name: { equals: legacyAgent.name, mode: "insensitive" },
        accountStatus: "LEGACY_CONFLICT",
        id: { not: canonicalPortal.id },
      },
    }));

  const staleIds = new Set<string>([LEGACY_AGENT_ID]);
  if (legacyPortal) {
    const more = await prismaPrimary.agent.findMany({
      where: {
        OR: [
          { email: { equals: legacyPortal.email, mode: "insensitive" } },
          { name: { equals: legacyPortal.name, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    for (const a of more) staleIds.add(a.id);
  }
  staleIds.delete(canonicalAgent.id);

  const moved: unknown[] = [];
  const deletedAgents: string[] = [];
  for (const staleId of staleIds) {
    const merged = await mergeAgentOwnership(
      staleId,
      { id: canonicalAgent.id, name: canonicalPortal.name },
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
        deletedAgents.push(staleId);
      }
    }
  }

  let actionRequests = 0;
  if (legacyPortal) {
    actionRequests = apply
      ? (
          await prismaPrimary.accountActionRequest.updateMany({
            where: { portalAccountId: legacyPortal.id },
            data: { portalAccountId: canonicalPortal.id },
          })
        ).count
      : await prismaPrimary.accountActionRequest.count({
          where: { portalAccountId: legacyPortal.id },
        });

    if (apply) {
      if (legacyPortal.staffDesignatedCompanyId && !canonicalPortal.staffDesignatedCompanyId) {
        await prismaPrimary.portalAccount.update({
          where: { id: canonicalPortal.id },
          data: { staffDesignatedCompanyId: legacyPortal.staffDesignatedCompanyId },
        });
      }
      await prismaPrimary.portalMergeMapping.upsert({
        where: { portalAccountId: canonicalPortal.id },
        create: {
          portalAccountId: canonicalPortal.id,
          mergedSourceUserId: SOURCE_USER_ID,
          legacyPortalEmail: legacyPortal.email,
          legacyUsername: legacyPortal.username,
          lastSyncedAt: new Date(),
        },
        update: {
          legacyPortalEmail: legacyPortal.email,
          lastSyncedAt: new Date(),
        },
      });
      await prismaPrimary.portalAccount.update({
        where: { id: legacyPortal.id },
        data: {
          accountStatus: "LEGACY_MERGED",
          username: null,
        },
      });
      await prismaAuth.user.updateMany({
        where: { portalAccountId: legacyPortal.id },
        data: { portalAccountId: null },
      });
    }
  }

  // Post-check: Insights card should no longer appear for legacy agent.
  const leftoverTickets = apply
    ? await prismaPrimary.ticket.count({ where: { assignedAgentId: LEGACY_AGENT_ID } })
    : null;
  const hrisTicketSample = await prismaPrimary.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00124" },
    select: { ticketNumber: true, assignedAgentId: true, status: true },
  });

  console.log(apply ? "=== Applied ===" : "=== Dry run (pass --apply to write) ===");
  console.log(
    JSON.stringify(
      {
        canonicalAgent,
        legacyAgent,
        canonicalPortal: {
          id: canonicalPortal.id,
          name: canonicalPortal.name,
          email: canonicalPortal.email,
          accountStatus: canonicalPortal.accountStatus,
          mergedSourceUserId: canonicalPortal.mergedSourceUserId?.toString() ?? null,
        },
        legacyPortal: legacyPortal
          ? {
              id: legacyPortal.id,
              name: legacyPortal.name,
              email: legacyPortal.email,
              accountStatus: legacyPortal.accountStatus,
            }
          : null,
        staleAgentIds: [...staleIds],
        moved,
        actionRequests,
        deletedAgents,
        leftoverTicketsOnLegacy: leftoverTickets,
        req00124: hrisTicketSample,
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
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
    await prismaSecondary.$disconnect();
  });
