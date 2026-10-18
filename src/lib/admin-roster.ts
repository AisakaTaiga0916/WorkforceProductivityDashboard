import type { Agent, Team } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { normalizePersonName } from "@/lib/person-name";

export { normalizePersonName };

/** Same identity check as pickCanonicalAgentForPortal (email first, then normalized name). */
export function agentMatchesPortalStaff<
  T extends { id: string; email: string; name: string },
>(portal: { email: string; name: string }, agent: T): boolean {
  const pe = portal.email.trim().toLowerCase();
  return (
    agent.email.trim().toLowerCase() === pe ||
    normalizePersonName(agent.name) === normalizePersonName(portal.name)
  );
}

export type AgentWithTeam = Agent & { team: Team };

/**
 * When portal email was updated or a second Agent row was created by name match only,
 * multiple Agent rows can refer to the same staff person. Pick a single canonical row.
 */
export function pickCanonicalAgentForPortal<
  T extends { id: string; email: string; name: string; createdAt: Date },
>(portal: { email: string; name: string }, agents: T[]): T | null {
  const matching = agents.filter((a) => agentMatchesPortalStaff(portal, a));
  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0];
  const pe = portal.email.trim().toLowerCase();
  const emailHit = matching.find((a) => a.email.trim().toLowerCase() === pe);
  return (
    emailHit ??
    matching.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
  );
}

export function portalStaffHasAgentRow<
  T extends { id: string; email: string; name: string; createdAt: Date },
>(portal: { email: string; name: string }, agents: T[]): boolean {
  return pickCanonicalAgentForPortal(portal, agents) !== null;
}

/**
 * Ensure a staff portal account has a matching Agent row attached to the given team.
 * Used after the SuperAdmin sets a designated company so that there is no separate
 * "awaiting team assignment" step: the agent row is created (or re-pointed) inline.
 */
export async function ensureAgentRowForPortalStaff(
  portal: { email: string; name: string },
  teamId: string,
): Promise<void> {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "asc" } });
  const canonical = pickCanonicalAgentForPortal(portal, agents);
  const email = portal.email.trim().toLowerCase();
  if (!canonical) {
    await prisma.agent.create({
      data: { name: portal.name, email, teamId },
    });
    return;
  }
  const data: { teamId?: string; email?: string; name?: string } = {};
  if (canonical.teamId !== teamId) data.teamId = teamId;
  if (canonical.email.trim().toLowerCase() !== email) {
    const emailTaken = agents.some(
      (a) => a.id !== canonical.id && a.email.trim().toLowerCase() === email,
    );
    if (!emailTaken) data.email = email;
  }
  if (canonical.name !== portal.name) data.name = portal.name;
  if (Object.keys(data).length > 0) {
    await prisma.agent.update({ where: { id: canonical.id }, data });
  }
}
