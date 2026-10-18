/**
 * Promote HRIS merged_users onto Personnel roster and move PostgreSQL-only progress
 * onto the matching HRIS-linked agents.
 *
 * - Assign staffDesignatedCompanyId from merged company (MCONPINCO→MCHISI, etc.)
 * - Ensure Agent rows for every ACTIVE HRIS-linked staff portal
 * - Remap tickets / KPIs / tasks from unlinked PG portal agents → HRIS agents
 *
 * Usage:
 *   npx tsx scripts/promote-hris-personnel.ts
 *   npx tsx scripts/promote-hris-personnel.ts --apply
 */
import { Prisma } from "@prisma/client/primary";
import { ensureAgentRowForPortalStaff } from "../src/lib/admin-roster";
import { samePersonName } from "../src/modules/platform/auth/person-match";
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { resolveRosterCompanyName } from "../src/modules/hierarchy/hris-company-aliases";
import { ensureRosterTeamsInDb } from "../src/lib/roster-teams";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";
import { isStaffPortalRole } from "../src/lib/staff-role";

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
};

function replaceAssignedAgentIdInJson(
  value: unknown,
  staleId: string,
  canonical: { id: string; name: string },
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => replaceAssignedAgentIdInJson(entry, staleId, canonical));
  }
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (key === "assignedAgentId" && raw === staleId) {
      next.assignedAgentId = canonical.id;
      next.assignedAgentName = canonical.name;
      continue;
    }
    next[key] = replaceAssignedAgentIdInJson(raw, staleId, canonical);
  }
  return next;
}

async function remapAgentWork(
  staleId: string,
  canonical: { id: string; name: string },
  apply: boolean,
) {
  let tickets = 0;
  let kpis = 0;
  let tasks = 0;
  let subKpis = 0;

  if (apply) {
    tickets = (
      await prismaPrimary.ticket.updateMany({
        where: { assignedAgentId: staleId },
        data: { assignedAgentId: canonical.id },
      })
    ).count;
    kpis = (
      await prismaPrimary.kpiMaintenance.updateMany({
        where: { assignedAgentId: staleId },
        data: { assignedAgentId: canonical.id },
      })
    ).count;
    tasks = (
      await prismaPrimary.taskItem.updateMany({
        where: { assignedAgentId: staleId },
        data: { assignedAgentId: canonical.id },
      })
    ).count;
  } else {
    tickets = await prismaPrimary.ticket.count({ where: { assignedAgentId: staleId } });
    kpis = await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: staleId } });
    tasks = await prismaPrimary.taskItem.count({ where: { assignedAgentId: staleId } });
  }

  const kpiRows = await prismaPrimary.kpiMaintenance.findMany({
    where: { subKpis: { not: Prisma.DbNull } },
    select: { id: true, subKpis: true },
  });
  for (const row of kpiRows) {
    if (!JSON.stringify(row.subKpis).includes(staleId)) continue;
    subKpis += 1;
    if (apply) {
      await prismaPrimary.kpiMaintenance.update({
        where: { id: row.id },
        data: {
          subKpis: replaceAssignedAgentIdInJson(
            row.subKpis,
            staleId,
            canonical,
          ) as Prisma.InputJsonValue,
        },
      });
    }
  }

  return { tickets, kpis, tasks, subKpis };
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "[promote-hris-personnel] APPLY" : "[promote-hris-personnel] DRY RUN");

  await ensureRosterTeamsInDb();

  const merged = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, username, name, email, role, company_name
    FROM merged_users WHERE is_active = 1 ORDER BY source_user_id
  `;

  let synced = 0;
  let companiesAssigned = 0;
  let agentsEnsured = 0;
  let companyUnresolved = 0;

  for (const row of merged) {
    const roster = resolveRosterCompanyName(row.company_name);
    if (!roster && row.company_name) companyUnresolved++;

    if (apply) {
      await syncPortalProfile(
        canonicalProfileFromMerged({
          sourceUserId: row.source_user_id,
          username: row.username,
          name: row.name,
          email: row.email,
          role: row.role,
          companyName: row.company_name,
        }),
        "hris",
      );
      synced++;
    }

    const portal = await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId: row.source_user_id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        staffDesignatedCompanyId: true,
        accountStatus: true,
      },
    });
    if (!portal || portal.accountStatus !== "ACTIVE") continue;
    if (!isStaffPortalRole(portal.role)) continue;

    let teamId = portal.staffDesignatedCompanyId;
    if (roster) {
      const team = await prismaPrimary.team.findFirst({
        where: { name: roster },
        select: { id: true },
      });
      if (team) {
        if (portal.staffDesignatedCompanyId !== team.id) companiesAssigned++;
        teamId = team.id;
        if (apply) {
          await prismaPrimary.portalAccount.update({
            where: { id: portal.id },
            data: { staffDesignatedCompanyId: team.id },
          });
        }
      }
    }

    if (teamId) {
      agentsEnsured++;
      if (apply) {
        await ensureAgentRowForPortalStaff(
          { email: portal.email, name: portal.name },
          teamId,
        );
      }
    }
  }

  // Remap progress from PostgreSQL-only portals onto HRIS-linked agents (same person).
  const [hrisPortals, pgOnlyPortals, agents] = await Promise.all([
    prismaPrimary.portalAccount.findMany({
      where: { mergedSourceUserId: { not: null }, accountStatus: "ACTIVE" },
      select: { id: true, email: true, name: true },
    }),
    prismaPrimary.portalAccount.findMany({
      where: {
        mergedSourceUserId: null,
        accountStatus: { in: ["ACTIVE", "LEGACY_MERGED", "LEGACY_CONFLICT"] },
      },
      select: { id: true, email: true, name: true, accountStatus: true },
    }),
    prismaPrimary.agent.findMany({
      select: { id: true, email: true, name: true },
    }),
  ]);

  const hrisAgents = agents.filter((a) =>
    hrisPortals.some(
      (p) =>
        p.email.trim().toLowerCase() === a.email.trim().toLowerCase() ||
        samePersonName(p.name, a.name),
    ),
  );

  let remappedAgents = 0;
  let deletedAgents = 0;
  const workMoved = { tickets: 0, kpis: 0, tasks: 0, subKpis: 0 };

  for (const pg of pgOnlyPortals) {
    const staleAgents = agents.filter(
      (a) =>
        a.email.trim().toLowerCase() === pg.email.trim().toLowerCase() ||
        samePersonName(a.name, pg.name),
    );
    if (staleAgents.length === 0) continue;

    const hrisPortal = hrisPortals.find((p) => samePersonName(p.name, pg.name));
    if (!hrisPortal) continue;

    const canonicalAgent =
      hrisAgents.find(
        (a) => a.email.trim().toLowerCase() === hrisPortal.email.trim().toLowerCase(),
      ) ??
      hrisAgents.find((a) => samePersonName(a.name, hrisPortal.name));
    if (!canonicalAgent) continue;

    for (const stale of staleAgents) {
      if (stale.id === canonicalAgent.id) continue;
      remappedAgents++;
      const moved = await remapAgentWork(
        stale.id,
        { id: canonicalAgent.id, name: hrisPortal.name },
        apply,
      );
      workMoved.tickets += moved.tickets;
      workMoved.kpis += moved.kpis;
      workMoved.tasks += moved.tasks;
      workMoved.subKpis += moved.subKpis;

      if (apply) {
        const still =
          (await prismaPrimary.ticket.count({ where: { assignedAgentId: stale.id } })) +
          (await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: stale.id } })) +
          (await prismaPrimary.taskItem.count({ where: { assignedAgentId: stale.id } }));
        const subStill = (
          await prismaPrimary.kpiMaintenance.findMany({
            where: { subKpis: { not: Prisma.DbNull } },
            select: { subKpis: true },
          })
        ).some((r) => JSON.stringify(r.subKpis).includes(stale.id));
        if (still === 0 && !subStill) {
          await prismaPrimary.agent.delete({ where: { id: stale.id } });
          deletedAgents++;
        }
      }
    }

    if (apply && pg.accountStatus !== "LEGACY_MERGED") {
      // Soft-hide remaining PG duplicates so they never reappear on personnel
      await prismaPrimary.portalAccount.update({
        where: { id: pg.id },
        data: {
          accountStatus:
            pg.accountStatus === "LEGACY_CONFLICT" ? "LEGACY_CONFLICT" : "LEGACY_MERGED",
          username: null,
        },
      });
    }
  }

  // Count how many HRIS staff will show on Personnel after this run
  const ready = await prismaPrimary.portalAccount.count({
    where: {
      mergedSourceUserId: { not: null },
      accountStatus: "ACTIVE",
      staffDesignatedCompanyId: { not: null },
      role: { in: ["Admin", "Personnel", "SuperAdmin"] },
    },
  });

  console.log(
    JSON.stringify(
      {
        mergedUsers: merged.length,
        profilesSynced: synced,
        companiesAssigned,
        companyUnresolved,
        agentsEnsured,
        remappedAgents,
        deletedAgents,
        workMoved,
        hrisStaffReadyForPersonnel: ready,
        apply,
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
    await prismaSecondary.$disconnect();
  });
