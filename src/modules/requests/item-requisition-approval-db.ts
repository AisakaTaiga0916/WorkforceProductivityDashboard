import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  defaultItemRequisitionApprovalMeta,
  parseItemRequisitionApprovalMeta,
  type ItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval";

export async function loadItemRequisitionApprovalMeta(
  ticketId: string,
): Promise<ItemRequisitionApprovalMeta | null> {
  const rows = await prisma.$queryRaw<Array<{ item_requisition_approval_meta: unknown }>>`
    SELECT item_requisition_approval_meta FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  const raw = rows[0]?.item_requisition_approval_meta;
  if (raw == null) return null;
  return parseItemRequisitionApprovalMeta(raw);
}

export async function saveItemRequisitionApprovalMeta(
  ticketId: string,
  meta: ItemRequisitionApprovalMeta,
): Promise<void> {
  const json = JSON.stringify(meta);
  await prisma.$executeRaw`
    UPDATE tickets
    SET item_requisition_approval_meta = ${json}::jsonb
    WHERE id = ${ticketId}
  `;
}

export async function initItemRequisitionApprovalMetaIfNeeded(
  ticketId: string,
): Promise<ItemRequisitionApprovalMeta> {
  const existing = await loadItemRequisitionApprovalMeta(ticketId);
  if (existing) return existing;
  const meta = defaultItemRequisitionApprovalMeta();
  await saveItemRequisitionApprovalMeta(ticketId, meta);
  return meta;
}

export async function loadItemRequisitionApprovalMetaMap(
  ticketIds: string[],
): Promise<Map<string, ItemRequisitionApprovalMeta>> {
  const map = new Map<string, ItemRequisitionApprovalMeta>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; item_requisition_approval_meta: unknown }>
  >`
    SELECT id, item_requisition_approval_meta
    FROM tickets
    WHERE id IN (${Prisma.join(ticketIds)})
      AND item_requisition_approval_meta IS NOT NULL
  `;
  for (const row of rows) {
    const parsed = parseItemRequisitionApprovalMeta(row.item_requisition_approval_meta);
    if (parsed) map.set(row.id, parsed);
  }
  return map;
}
