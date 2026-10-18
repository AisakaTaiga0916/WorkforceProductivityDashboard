import { COMPANY_ROSTER, rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import { prisma } from "@/modules/platform/db/prisma";

const LEGACY_ACI_APMC_NAME = "ACI/APMC";
/** Legacy queue labels; canonical roster name is MCHISI LPG. */
const LEGACY_MCONPINCO_NAMES = ["MCONPINCO", "M.CONPINCO", "M Conpinco"] as const;
/** Legacy SBU label; canonical roster name is now MCHISI LPG (LPG company). */
const LEGACY_MCHISI_NAME = "MCHISI";
/** Legacy roster label; canonical roster name is now EAZZYGAS. */
const LEGACY_EAZYGAZ_NAME = "EAZYGAZ";

/** One-time split: combined ACI/APMC queue → APMC + roster ACI. */
async function migrateLegacyAciApmcTeam(): Promise<void> {
  const legacy = await prisma.team.findFirst({
    where: { name: LEGACY_ACI_APMC_NAME },
    select: { id: true },
  });
  if (!legacy) return;

  let apmc = await prisma.team.findFirst({ where: { name: "APMC" }, select: { id: true } });
  if (!apmc) {
    apmc = await prisma.team.update({
      where: { id: legacy.id },
      data: { name: "APMC" },
      select: { id: true },
    });
  } else if (apmc.id !== legacy.id) {
    await reassignTeamReferences(legacy.id, apmc.id);
    await deleteTeamIfExists(legacy.id);
  }

  const aci = await prisma.team.findFirst({ where: { name: "ACI" }, select: { id: true } });
  if (!aci) {
    await prisma.team.create({ data: { name: "ACI" } });
  }
}

async function reassignTeamReferences(fromTeamId: string, toTeamId: string): Promise<void> {
  if (fromTeamId === toTeamId) return;
  await prisma.portalAccount.updateMany({
    where: { companyId: fromTeamId },
    data: { companyId: toTeamId },
  });
  await prisma.portalAccount.updateMany({
    where: { staffDesignatedCompanyId: fromTeamId },
    data: { staffDesignatedCompanyId: toTeamId },
  });
  await prisma.ticket.updateMany({
    where: { teamId: fromTeamId },
    data: { teamId: toTeamId },
  });
  await prisma.agent.updateMany({
    where: { teamId: fromTeamId },
    data: { teamId: toTeamId },
  });
}

/** Idempotent delete — safe when migrations run concurrently or retry after partial completion. */
async function deleteTeamIfExists(teamId: string): Promise<void> {
  await prisma.team.deleteMany({ where: { id: teamId } });
}

/** One-time: legacy MCONPINCO / M.CONPINCO queue labels → roster MCHISI LPG. */
async function migrateLegacyMconpincoTeam(): Promise<void> {
  for (const legacyName of LEGACY_MCONPINCO_NAMES) {
    const legacy = await prisma.team.findFirst({
      where: { name: legacyName },
      select: { id: true },
    });
    if (!legacy) continue;

    const canonical = await prisma.team.findFirst({
      where: { name: "MCHISI LPG" },
      select: { id: true },
    });
    if (!canonical) {
      await prisma.team.update({
        where: { id: legacy.id },
        data: { name: "MCHISI LPG" },
      });
      continue;
    }
    if (canonical.id !== legacy.id) {
      await reassignTeamReferences(legacy.id, canonical.id);
      await deleteTeamIfExists(legacy.id);
    }
  }
}

/**
 * One-time: legacy MCHISI SBU removed from roster → fold into MCHISI LPG
 * (MCHISI FAMES remains a separate roster company).
 */
async function migrateLegacyMchisiSplit(): Promise<void> {
  const legacy = await prisma.team.findFirst({
    where: { name: LEGACY_MCHISI_NAME },
    select: { id: true },
  });
  if (!legacy) return;

  const lpg = await prisma.team.findFirst({
    where: { name: "MCHISI LPG" },
    select: { id: true },
  });
  if (!lpg) {
    await prisma.team.update({
      where: { id: legacy.id },
      data: { name: "MCHISI LPG" },
    });
    return;
  }
  if (lpg.id !== legacy.id) {
    await reassignTeamReferences(legacy.id, lpg.id);
    await deleteTeamIfExists(legacy.id);
  }
}

/** One-time: legacy EAZYGAZ queue label → roster EAZZYGAS. */
async function migrateLegacyEazygazTeam(): Promise<void> {
  const legacy = await prisma.team.findFirst({
    where: { name: LEGACY_EAZYGAZ_NAME },
    select: { id: true },
  });
  if (!legacy) return;

  const canonical = await prisma.team.findFirst({
    where: { name: "EAZZYGAS" },
    select: { id: true },
  });
  if (!canonical) {
    await prisma.team.update({
      where: { id: legacy.id },
      data: { name: "EAZZYGAS" },
    });
    return;
  }
  if (canonical.id !== legacy.id) {
    await reassignTeamReferences(legacy.id, canonical.id);
    await deleteTeamIfExists(legacy.id);
  }
}

/** Merge duplicate Team rows that share a roster company name (e.g. two MCHISI LPG). */
async function dedupeRosterTeamsByName(): Promise<void> {
  for (const name of COMPANY_ROSTER) {
    const teams = await prisma.team.findMany({
      where: { name },
      select: {
        id: true,
        _count: {
          select: {
            tickets: true,
            customerPortalAccounts: true,
            staffDesignatedPortalAccounts: true,
            agents: true,
          },
        },
      },
    });
    if (teams.length <= 1) continue;

    const score = (t: (typeof teams)[number]) =>
      t._count.tickets +
      t._count.customerPortalAccounts +
      t._count.staffDesignatedPortalAccounts +
      t._count.agents;

    const [keeper, ...dupes] = [...teams].sort((a, b) => score(b) - score(a));
    for (const d of dupes) {
      await reassignTeamReferences(d.id, keeper.id);
      await deleteTeamIfExists(d.id);
    }
  }
}

/** Ensure every roster SBU exists as a Team row (idempotent). */
export async function ensureRosterTeamsInDb(): Promise<void> {
  await migrateLegacyAciApmcTeam();
  await migrateLegacyMconpincoTeam();
  await migrateLegacyMchisiSplit();
  await migrateLegacyEazygazTeam();

  for (const name of COMPANY_ROSTER) {
    const existing = await prisma.team.findFirst({
      where: { name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.team.create({ data: { name } });
    }
  }

  await dedupeRosterTeamsByName();
}

export async function listRosterTeamsForSignup(): Promise<Array<{ id: string; name: string }>> {
  await ensureRosterTeamsInDb();
  const teams = await prisma.team.findMany({
    where: rosterTeamNameFilter(),
    select: { id: true, name: true },
  });
  return sortByRosterOrder(teams);
}
