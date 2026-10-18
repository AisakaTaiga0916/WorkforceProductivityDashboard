import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  defaultPaymentApprovalMeta,
  parsePaymentApprovalMeta,
  type PaymentApprovalMeta,
} from "@/modules/requests/request-for-payment-approval";

export async function loadPaymentApprovalMeta(ticketId: string): Promise<PaymentApprovalMeta | null> {
  const rows = await prisma.$queryRaw<Array<{ payment_approval_meta: unknown }>>`
    SELECT payment_approval_meta FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  const raw = rows[0]?.payment_approval_meta;
  if (raw == null) return null;
  return parsePaymentApprovalMeta(raw);
}

export type SavePaymentApprovalMetaResult =
  | { ok: true }
  | { ok: false; reason: "conflict" };

/**
 * Persist payment approval meta. When `expectedProceduralStep` is set, the write
 * is conditional so concurrent completes cannot rewind a later step.
 */
export async function savePaymentApprovalMeta(
  ticketId: string,
  meta: PaymentApprovalMeta,
  expectedProceduralStep?: string | null,
): Promise<SavePaymentApprovalMetaResult> {
  const json = JSON.stringify(meta);
  if (expectedProceduralStep != null && expectedProceduralStep !== "") {
    const updated = await prisma.$executeRaw`
      UPDATE tickets
      SET payment_approval_meta = ${json}::jsonb
      WHERE id = ${ticketId}
        AND (
          payment_approval_meta IS NULL
          OR payment_approval_meta->>'proceduralStep' = ${expectedProceduralStep}
        )
    `;
    if (Number(updated) === 0) return { ok: false, reason: "conflict" };
    return { ok: true };
  }
  await prisma.$executeRaw`
    UPDATE tickets
    SET payment_approval_meta = ${json}::jsonb
    WHERE id = ${ticketId}
  `;
  return { ok: true };
}

export async function initPaymentApprovalMetaIfNeeded(ticketId: string): Promise<PaymentApprovalMeta> {
  const existing = await loadPaymentApprovalMeta(ticketId);
  if (existing) return existing;
  const meta = defaultPaymentApprovalMeta();
  await savePaymentApprovalMeta(ticketId, meta);
  return meta;
}

export async function loadPaymentApprovalMetaMap(
  ticketIds: string[],
): Promise<Map<string, PaymentApprovalMeta>> {
  const map = new Map<string, PaymentApprovalMeta>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRaw<Array<{ id: string; payment_approval_meta: unknown }>>`
    SELECT id, payment_approval_meta
    FROM tickets
    WHERE id IN (${Prisma.join(ticketIds)})
      AND payment_approval_meta IS NOT NULL
  `;
  for (const row of rows) {
    const parsed = parsePaymentApprovalMeta(row.payment_approval_meta);
    if (parsed) map.set(row.id, parsed);
  }
  return map;
}
