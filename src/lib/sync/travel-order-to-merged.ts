/**
 * Push a confirmed Travel Order (timestamps, locations, travelers) into MergeDatabase.
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import {
  bootstrapMysqlUrl,
  ensureMergedTravelOrderTables,
  parseMysqlDatabaseName,
} from "../../../scripts/ensure-merged-task-kpi-tables";
import { prisma } from "@/modules/platform/db/prisma";
import {
  resolveSecondaryWriteUrl,
  withSecondaryWriteClient,
} from "@/modules/platform/db/prisma-secondary-write";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "@/lib/sync/merged-person-identity";
import type { TravelOrderRow } from "@/modules/work-plans/travel-order-db";

function resolveSourceTag(): string {
  return process.env.TICKETING_MERGE_SOURCE_TAG?.trim() || "ticketing_system";
}

function newRowId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function resolveMergedUserIdByEmail(
  db: PrismaClientSecondary,
  email: string | null | undefined,
): Promise<bigint | null> {
  const key = email?.trim().toLowerCase();
  if (!key) return null;

  const portal = await prisma.portalAccount.findFirst({
    where: { email: { equals: key, mode: "insensitive" } },
    select: { mergedSourceUserId: true },
  });
  if (portal?.mergedSourceUserId != null) {
    const rows = await db.$queryRaw<Array<{ source_user_id: bigint; name: string; email: string | null }>>`
      SELECT source_user_id, name, email FROM merged_users WHERE is_active = 1
    `;
    const canonical = buildCanonicalMergedIdMap(
      rows.map((r) => ({
        sourceUserId: r.source_user_id,
        name: r.name,
        email: r.email,
      })),
    );
    return canonicalMergedId(portal.mergedSourceUserId, canonical);
  }

  const byEmail = await db.$queryRaw<Array<{ source_user_id: bigint }>>`
    SELECT source_user_id FROM merged_users
    WHERE is_active = 1 AND LOWER(TRIM(email)) = ${key}
    LIMIT 1
  `;
  return byEmail[0]?.source_user_id ?? null;
}

export async function syncConfirmedTravelOrderToMerged(
  order: TravelOrderRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sourceTag = resolveSourceTag();
  const writeUrl = resolveSecondaryWriteUrl();
  const targetDb = parseMysqlDatabaseName(writeUrl) ?? "mergedatabase-dev";
  const bootstrapUrl = bootstrapMysqlUrl(writeUrl);

  const company = order.companyTeamId
    ? await prisma.company.findUnique({
        where: { id: order.companyTeamId },
        select: { id: true, name: true },
      })
    : null;

  const confirmedAt = asDate(order.updatedAt) ?? new Date();
  const travelerEmails = order.travelers.map((t) => t.email).filter(Boolean);

  try {
    const bootstrap = new PrismaClientSecondary({
      datasources: { db: { url: bootstrapUrl } },
    });
    try {
      await ensureMergedTravelOrderTables(bootstrap, targetDb, sourceTag);
    } finally {
      await bootstrap.$disconnect().catch(() => undefined);
    }

    await withSecondaryWriteClient(async (db) => {
      const confirmerMerged = await resolveMergedUserIdByEmail(
        db,
        order.confirmationByAgent?.email,
      );
      const creatorMerged = await resolveMergedUserIdByEmail(
        db,
        order.createdByAgent?.email,
      );

      await db.$executeRaw`
        INSERT INTO merged_travel_orders (
          source_id, source_database, kpi_maintenance_id, order_request, status, vehicle,
          company_team_id, company_name,
          confirmation_by_agent_id, confirmation_by_agent_email, confirmation_merged_user_id,
          created_by_agent_id, created_by_agent_email, created_by_merged_user_id,
          traveler_agent_ids, traveler_emails,
          kpi_percent, kpi_submitted_at, confirmed_at, created_at, updated_at
        ) VALUES (
          ${order.id},
          ${sourceTag},
          ${order.kpiMaintenanceId},
          ${order.orderRequest},
          ${order.status},
          ${order.vehicle},
          ${order.companyTeamId},
          ${company?.name ?? null},
          ${order.confirmationByAgentId},
          ${order.confirmationByAgent?.email ?? null},
          ${confirmerMerged},
          ${order.createdByAgentId},
          ${order.createdByAgent?.email ?? null},
          ${creatorMerged},
          ${JSON.stringify(order.travelerAgentIds)},
          ${JSON.stringify(travelerEmails)},
          ${order.kpiPercent},
          ${asDate(order.kpiSubmittedAt)},
          ${confirmedAt},
          ${asDate(order.createdAt) ?? confirmedAt},
          ${asDate(order.updatedAt) ?? confirmedAt}
        )
        ON DUPLICATE KEY UPDATE
          order_request = VALUES(order_request),
          status = VALUES(status),
          vehicle = VALUES(vehicle),
          company_team_id = VALUES(company_team_id),
          company_name = VALUES(company_name),
          confirmation_by_agent_id = VALUES(confirmation_by_agent_id),
          confirmation_by_agent_email = VALUES(confirmation_by_agent_email),
          confirmation_merged_user_id = VALUES(confirmation_merged_user_id),
          created_by_agent_id = VALUES(created_by_agent_id),
          created_by_agent_email = VALUES(created_by_agent_email),
          created_by_merged_user_id = VALUES(created_by_merged_user_id),
          traveler_agent_ids = VALUES(traveler_agent_ids),
          traveler_emails = VALUES(traveler_emails),
          kpi_percent = VALUES(kpi_percent),
          kpi_submitted_at = VALUES(kpi_submitted_at),
          confirmed_at = VALUES(confirmed_at),
          updated_at = VALUES(updated_at)
      `;

      await db.$executeRaw`
        DELETE FROM merged_travel_order_locations
        WHERE source_database = ${sourceTag} AND travel_order_source_id = ${order.id}
      `;
      await db.$executeRaw`
        DELETE FROM merged_travel_order_travelers
        WHERE source_database = ${sourceTag} AND travel_order_source_id = ${order.id}
      `;

      for (const loc of order.locations) {
        const startedAt = asDate(loc.startedAt);
        const endedAt = asDate(loc.endedAt);
        const checkedAt = asDate(loc.checkedAt);
        await db.$executeRaw`
          INSERT INTO merged_travel_order_locations (
            id, travel_order_source_id, source_database, location_source_id, label, sort_order,
            started_at, started_latitude, started_longitude,
            ended_at, ended_latitude, ended_longitude, checked_at, remarks
          ) VALUES (
            ${newRowId()},
            ${order.id},
            ${sourceTag},
            ${loc.id},
            ${loc.label.slice(0, 512)},
            ${loc.sortOrder},
            ${startedAt},
            ${loc.startedLatitude},
            ${loc.startedLongitude},
            ${endedAt},
            ${loc.endedLatitude},
            ${loc.endedLongitude},
            ${checkedAt},
            ${loc.remarks}
          )
          ON DUPLICATE KEY UPDATE
            label = VALUES(label),
            sort_order = VALUES(sort_order),
            started_at = VALUES(started_at),
            started_latitude = VALUES(started_latitude),
            started_longitude = VALUES(started_longitude),
            ended_at = VALUES(ended_at),
            ended_latitude = VALUES(ended_latitude),
            ended_longitude = VALUES(ended_longitude),
            checked_at = VALUES(checked_at),
            remarks = VALUES(remarks)
        `;
      }

      const travelerList =
        order.travelers.length > 0
          ? order.travelers
          : order.travelerAgentIds.map((id) => ({
              id,
              name: id,
              email: "",
            }));

      for (const traveler of travelerList) {
        const mergedId = await resolveMergedUserIdByEmail(db, traveler.email || null);
        await db.$executeRaw`
          INSERT INTO merged_travel_order_travelers (
            id, travel_order_source_id, source_database, agent_id, agent_email,
            display_name, merged_source_user_id, company_team_id, company_name
          ) VALUES (
            ${newRowId()},
            ${order.id},
            ${sourceTag},
            ${traveler.id},
            ${traveler.email || null},
            ${(traveler.name || traveler.id).slice(0, 255)},
            ${mergedId},
            ${order.companyTeamId},
            ${company?.name ?? null}
          )
          ON DUPLICATE KEY UPDATE
            agent_email = VALUES(agent_email),
            display_name = VALUES(display_name),
            merged_source_user_id = VALUES(merged_source_user_id),
            company_team_id = VALUES(company_team_id),
            company_name = VALUES(company_name)
        `;
      }
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[travel-order-to-merged] sync failed:", message);
    return { ok: false, error: message };
  }
}
