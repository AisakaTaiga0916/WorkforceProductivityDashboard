import type { Prisma } from "@prisma/client/primary";
import { pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { prisma } from "@/modules/platform/db/prisma";

type SessionIdentity = {
  email?: string | null;
  name?: string | null;
};

function whereFromIdentity(identity: SessionIdentity): Prisma.AgentWhereInput | undefined {
  const normalizedEmail = (identity.email ?? "").trim().toLowerCase();
  const normalizedName = (identity.name ?? "").trim();
  // Prefer exact email only — never OR-widen with name (avoids binding to another Agent).
  if (normalizedEmail) {
    return { email: { equals: normalizedEmail, mode: "insensitive" } };
  }
  if (normalizedName) return { name: normalizedName };
  return undefined;
}

async function findMatchingSessionAgents(identity: SessionIdentity) {
  const where = whereFromIdentity(identity);
  if (!where) return [];
  return prisma.agent.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
}

function pickSessionAgent<T extends { id: string; email: string; name: string; createdAt: Date }>(
  identity: SessionIdentity,
  agents: T[],
): T | null {
  if (agents.length === 0) return null;
  if (agents.length === 1) return agents[0];
  return pickCanonicalAgentForPortal(
    { email: identity.email ?? "", name: identity.name ?? "" },
    agents,
  );
}

export async function findSessionAgentId(identity: SessionIdentity) {
  const agent = pickSessionAgent(identity, await findMatchingSessionAgents(identity));
  return agent ? { id: agent.id } : null;
}

export async function findSessionAgentWithTeam(identity: SessionIdentity) {
  const where = whereFromIdentity(identity);
  if (!where) return null;
  const agents = await prisma.agent.findMany({
    where,
    include: { team: true },
    orderBy: { createdAt: "asc" },
  });
  return pickSessionAgent(identity, agents);
}
