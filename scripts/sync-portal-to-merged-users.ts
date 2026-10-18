/**
 * Sync portal_accounts with merged_users (HRIS) without losing KPI/task/ticket progress.
 *
 * Strategy:
 * 1. Match portals → merged users by mergedSourceUserId, username, email, then fuzzy name
 * 2. Collapse duplicate portals for the same HRIS person into one canonical portal
 * 3. Remap Agent rows (and their tickets/KPIs/tasks/sub-assignees) onto one canonical agent
 * 4. Sync username/name/role from merged_users onto the canonical portal
 *
 * Usage:
 *   npx tsx scripts/sync-portal-to-merged-users.ts
 *   npx tsx scripts/sync-portal-to-merged-users.ts --apply
 */
import { Prisma } from "@prisma/client/primary";
import { samePersonName } from "../src/modules/platform/auth/person-match";
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { mapHrisToPortalRole } from "../src/modules/platform/auth/role-mapping";
import { MERGED_SOURCE_DATABASE } from "../src/lib/merged-database-sources";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
};

type PortalRow = {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: string;
  mergedSourceUserId: bigint | null;
  accountStatus: string;
  staffDesignatedCompanyId: string | null;
};

type AgentRow = {
  id: string;
  email: string;
  name: string;
  teamId: string;
  createdAt: Date;
};

function norm(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return s || null;
}

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

async function agentWorkScore(agentId: string): Promise<number> {
  const [tickets, kpis, tasks] = await Promise.all([
    prismaPrimary.ticket.count({ where: { assignedAgentId: agentId } }),
    prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: agentId } }),
    prismaPrimary.taskItem.count({ where: { assignedAgentId: agentId } }),
  ]);
  return tickets * 10 + kpis * 5 + tasks * 5;
}

async function remapAgentWork(
  staleId: string,
  canonical: { id: string; name: string },
  apply: boolean,
): Promise<{ tickets: number; kpis: number; tasks: number; subKpis: number }> {
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
          subKpis: replaceAssignedAgentIdInJson(row.subKpis, staleId, canonical) as Prisma.InputJsonValue,
        },
      });
    }
  }

  return { tickets, kpis, tasks, subKpis };
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "[sync-portal-to-merged] APPLY mode" : "[sync-portal-to-merged] DRY RUN (pass --apply)");

  const [portals, agents, merged] = await Promise.all([
    prismaPrimary.portalAccount.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        mergedSourceUserId: true,
        accountStatus: true,
        staffDesignatedCompanyId: true,
      },
    }) as Promise<PortalRow[]>,
    prismaPrimary.agent.findMany({
      select: { id: true, email: true, name: true, teamId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }) as Promise<AgentRow[]>,
    prismaSecondary.$queryRaw<MergedRow[]>`
      SELECT source_user_id, username, name, email, role, company_name
      FROM merged_users WHERE is_active = 1 ORDER BY source_user_id
    `,
  ]);

  const claimedPortalIds = new Set<string>();
  let matchedByUsername = 0;
  let matchedByEmail = 0;
  let matchedByName = 0;
  let alreadyLinked = 0;
  let portalsCollapsed = 0;
  let agentsRemapped = 0;
  let agentsDeleted = 0;
  let workMoved = { tickets: 0, kpis: 0, tasks: 0, subKpis: 0 };
  let profilesSynced = 0;

  for (const row of merged) {
    const username = norm(row.username);
    const email = norm(row.email);
    const sourceUserId = row.source_user_id;

    const candidates: PortalRow[] = [];
    const pushUnique = (p: PortalRow | undefined | null) => {
      if (!p) return;
      if (candidates.some((c) => c.id === p.id)) return;
      candidates.push(p);
    };

    pushUnique(portals.find((p) => p.mergedSourceUserId === sourceUserId));
    if (username) {
      for (const p of portals.filter((x) => norm(x.username) === username)) pushUnique(p);
    }
    if (email) {
      pushUnique(portals.find((p) => norm(p.email) === email));
    }
    for (const p of portals) {
      if (p.accountStatus === "LEGACY_CONFLICT" || p.accountStatus === "LEGACY_MERGED") continue;
      // Never steal a portal already linked to a different HRIS user (same-name siblings).
      if (p.mergedSourceUserId != null && p.mergedSourceUserId !== sourceUserId) continue;
      if (samePersonName(p.name, row.name)) pushUnique(p);
    }

    if (candidates.length === 0) {
      // Create via sync layer
      if (apply) {
        await syncPortalProfile(
          canonicalProfileFromMerged({
            sourceUserId,
            username: row.username,
            name: row.name,
            email: row.email,
            role: row.role,
            companyName: row.company_name,
          }),
          "hris",
        );
        profilesSynced++;
      }
      continue;
    }

    // Prefer already-linked, then ACTIVE with username match, then oldest
    candidates.sort((a, b) => {
      const score = (p: PortalRow) => {
        let s = 0;
        if (p.mergedSourceUserId === sourceUserId) s += 100;
        if (username && norm(p.username) === username) s += 50;
        if (email && norm(p.email) === email) s += 40;
        if (p.accountStatus === "ACTIVE") s += 10;
        return s;
      };
      const d = score(b) - score(a);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

    const canonical = candidates[0]!;
    claimedPortalIds.add(canonical.id);

    if (canonical.mergedSourceUserId === sourceUserId) alreadyLinked++;
    else if (username && norm(canonical.username) === username) matchedByUsername++;
    else if (email && norm(canonical.email) === email) matchedByEmail++;
    else matchedByName++;

    // Collapse duplicate portals for this person
    for (const dup of candidates.slice(1)) {
      claimedPortalIds.add(dup.id);
      portalsCollapsed++;
      if (apply) {
        // Free unique username/email before marking legacy
        await prismaPrimary.portalAccount.update({
          where: { id: dup.id },
          data: {
            username: null,
            accountStatus: "LEGACY_MERGED",
            mergedSourceUserId: null,
            // Keep email unique: suffix if it would collide after syncing canonical to HRIS email
          },
        });
      }
    }

    // Sync canonical portal profile from HRIS (preserve portal id)
    if (apply) {
      // If another ACTIVE portal still holds the HRIS email, clear it first
      if (email) {
        const emailOwner = await prismaPrimary.portalAccount.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            NOT: { id: canonical.id },
          },
          select: { id: true },
        });
        if (emailOwner) {
          await prismaPrimary.portalAccount.update({
            where: { id: emailOwner.id },
            data: {
              email: `legacy+${emailOwner.id.slice(0, 8)}.${email}`,
              username: null,
              accountStatus: "LEGACY_MERGED",
              mergedSourceUserId: null,
            },
          });
          portalsCollapsed++;
        }
      }

      const mapped = mapHrisToPortalRole({ hrisRole: row.role });
      const targetEmail = email ?? canonical.email;
      await prismaPrimary.portalAccount.update({
        where: { id: canonical.id },
        data: {
          email: targetEmail,
          username: username ?? canonical.username,
          name: row.name.trim() || canonical.name,
          mergedSourceUserId: sourceUserId,
          accountStatus: "ACTIVE",
          role: mapped.portalRole,
          headPrivileges: mapped.headPrivileges,
          profileSyncedAt: new Date(),
        },
      });
      profilesSynced++;

      // Refresh local copy for agent matching
      canonical.email = targetEmail;
      canonical.username = username ?? canonical.username;
      canonical.name = row.name.trim() || canonical.name;
      canonical.mergedSourceUserId = sourceUserId;
      canonical.accountStatus = "ACTIVE";
      canonical.role = mapped.portalRole;
    }

    // Agents matching any candidate portal (email or fuzzy name) — refresh from DB after prior deletes
    const liveAgents = apply
      ? ((await prismaPrimary.agent.findMany({
          select: { id: true, email: true, name: true, teamId: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })) as AgentRow[])
      : agents;

    const matchingAgents = liveAgents.filter((a) => {
      const aEmail = norm(a.email);
      return candidates.some(
        (p) =>
          aEmail === norm(p.email) ||
          aEmail === email ||
          samePersonName(a.name, p.name) ||
          samePersonName(a.name, row.name),
      );
    });

    if (matchingAgents.length === 0) continue;

    // Prefer agent that already has the portal email; else most work; else oldest
    const portalEmail = canonical.email.trim().toLowerCase();
    let best =
      matchingAgents.find((a) => a.email.trim().toLowerCase() === portalEmail) ?? matchingAgents[0]!;
    let bestScore = await agentWorkScore(best.id);
    for (const a of matchingAgents) {
      if (a.id === best.id) continue;
      const score = await agentWorkScore(a.id);
      const preferEmail = a.email.trim().toLowerCase() === portalEmail;
      const bestHasEmail = best.email.trim().toLowerCase() === portalEmail;
      if (preferEmail && !bestHasEmail) {
        best = a;
        bestScore = score;
        continue;
      }
      if (preferEmail === bestHasEmail && (score > bestScore || (score === bestScore && a.createdAt < best.createdAt))) {
        best = a;
        bestScore = score;
      }
    }

    // Remap/delete stale agents first so canonical can take the portal email uniquely
    for (const stale of matchingAgents) {
      if (stale.id === best.id) continue;
      agentsRemapped++;
      const moved = await remapAgentWork(stale.id, { id: best.id, name: canonical.name }, apply);
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
          agentsDeleted++;
        } else {
          // Free unique email if we cannot delete yet
          await prismaPrimary.agent.update({
            where: { id: stale.id },
            data: { email: `stale+${stale.id.slice(0, 8)}.${stale.email}` },
          });
        }
      }
    }

    if (apply) {
      await prismaPrimary.agent.update({
        where: { id: best.id },
        data: {
          email: portalEmail,
          name: canonical.name,
          ...(canonical.staffDesignatedCompanyId
            ? { teamId: canonical.staffDesignatedCompanyId }
            : {}),
        },
      });
    }
  }

  // Mark remaining unlinked ACTIVE portals that fuzzy-match a merged user (missed above)
  let leftoverLegacy = 0;
  for (const p of portals) {
    if (claimedPortalIds.has(p.id)) continue;
    if (p.mergedSourceUserId != null) continue;
    if (p.accountStatus !== "ACTIVE") continue;
    const hit = merged.find((m) => {
      // Skip if another portal already owns this merged user
      const owner = portals.find((x) => x.mergedSourceUserId === m.source_user_id);
      if (owner && owner.id !== p.id) return false;
      return samePersonName(p.name, m.name);
    });
    if (!hit) continue;
    leftoverLegacy++;
    if (apply) {
      await prismaPrimary.portalAccount.update({
        where: { id: p.id },
        data: {
          username: null,
          accountStatus: "LEGACY_MERGED",
          mergedSourceUserId: null,
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        sourceDatabase: MERGED_SOURCE_DATABASE.HRIS,
        mergedUsers: merged.length,
        alreadyLinked,
        matchedByUsername,
        matchedByEmail,
        matchedByName,
        profilesSynced,
        portalsCollapsed,
        leftoverLegacy,
        agentsRemapped,
        agentsDeleted,
        workMoved,
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
