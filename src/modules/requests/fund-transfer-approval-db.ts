import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import { findSessionAgentId } from "@/lib/session-agent";
import {
  defaultFundTransferApprovalMeta,
  parseFundTransferApprovalMeta,
  stampFundTransferCreatorAsPreparedBy,
  type FundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval";

export async function loadFundTransferApprovalMeta(
  ticketId: string,
): Promise<FundTransferApprovalMeta | null> {
  const rows = await prisma.$queryRaw<Array<{ fund_transfer_approval_meta: unknown }>>`
    SELECT fund_transfer_approval_meta FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  const raw = rows[0]?.fund_transfer_approval_meta;
  if (raw == null) return null;
  return parseFundTransferApprovalMeta(raw);
}

export async function saveFundTransferApprovalMeta(
  ticketId: string,
  meta: FundTransferApprovalMeta,
): Promise<void> {
  const json = JSON.stringify(meta);
  await prisma.$executeRaw`
    UPDATE tickets
    SET fund_transfer_approval_meta = ${json}::jsonb
    WHERE id = ${ticketId}
  `;
}

export async function initFundTransferApprovalMetaIfNeeded(
  ticketId: string,
): Promise<FundTransferApprovalMeta> {
  const existing = await loadFundTransferApprovalMeta(ticketId);
  if (existing) return existing;
  const meta = defaultFundTransferApprovalMeta();
  await saveFundTransferApprovalMeta(ticketId, meta);
  return meta;
}

/** Resolve or create an agent row for the person who submitted the FTR. */
export async function resolveFundTransferCreatorAgentId(opts: {
  email?: string | null;
  name?: string | null;
  teamId?: string | null;
}): Promise<string | null> {
  const email = (opts.email ?? "").trim().toLowerCase();
  const name = (opts.name ?? "").trim() || email;
  if (!email && !name) return null;

  const existing = await findSessionAgentId({ email, name });
  if (existing?.id) return existing.id;

  if (!email || !opts.teamId) return null;
  await ensureAgentRowForPortalStaff({ email, name }, opts.teamId);
  const created = await findSessionAgentId({ email, name });
  return created?.id ?? null;
}

/** After ticket create (or lazy backfill): set Prepared By to the creator and complete that step. */
export async function stampFundTransferCreatorOnCreate(opts: {
  ticketId: string;
  email?: string | null;
  name?: string | null;
  teamId?: string | null;
}): Promise<FundTransferApprovalMeta> {
  const meta = await initFundTransferApprovalMetaIfNeeded(opts.ticketId);
  if (meta.preparedByAgentId && meta.completed.PREPARED_BY) {
    return meta;
  }
  const creatorAgentId =
    meta.preparedByAgentId ??
    (await resolveFundTransferCreatorAgentId({
      email: opts.email,
      name: opts.name,
      teamId: opts.teamId,
    }));
  if (!creatorAgentId) return meta;
  const stamped = stampFundTransferCreatorAsPreparedBy(meta, creatorAgentId);
  await saveFundTransferApprovalMeta(opts.ticketId, stamped);
  return stamped;
}

export async function loadFundTransferApprovalMetaMap(
  ticketIds: string[],
): Promise<Map<string, FundTransferApprovalMeta>> {
  const map = new Map<string, FundTransferApprovalMeta>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; fund_transfer_approval_meta: unknown }>
  >`
    SELECT id, fund_transfer_approval_meta
    FROM tickets
    WHERE id IN (${Prisma.join(ticketIds)})
      AND fund_transfer_approval_meta IS NOT NULL
  `;
  for (const row of rows) {
    const parsed = parseFundTransferApprovalMeta(row.fund_transfer_approval_meta);
    if (parsed) map.set(row.id, parsed);
  }
  return map;
}
