import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import type { EfficiencyFrequency } from "@/modules/tasks/efficiency/user-efficiency-breakdown";
import {
  createEfficiencyQueryClient,
  getEfficiencyLeaderboard,
  getUserEfficiencyForPeriod,
  getUserEfficiencyTaskBreakdown,
} from "@/modules/tasks/efficiency/user-efficiency-queries";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { loadCompanyDirectory } from "@/modules/platform/companies/company-directory";

const FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "LIFETIME"]);

/**
 * GET /api/admin/efficiency?mode=leaderboard|user|details|personnel
 *  &periodKey=2026-07&frequency=MONTHLY
 *  &sourceUserId=1671 (for user/details)
 *
 * Reads from MySQL mergedatabase (task / user efficiencies).
 * Ticket activity + ticket metrics remain in PostgreSQL.
 */
export async function GET(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") ?? "leaderboard").trim().toLowerCase();
  const periodKey = searchParams.get("periodKey")?.trim() ?? "";
  const frequencyRaw = (searchParams.get("frequency") ?? "MONTHLY").trim().toUpperCase();
  if (!periodKey || !FREQ.has(frequencyRaw)) {
    return NextResponse.json(
      {
        error:
          "periodKey and frequency (DAILY|WEEKLY|MONTHLY|QUARTERLY|LIFETIME) are required.",
      },
      { status: 400 },
    );
  }
  const frequency = frequencyRaw as EfficiencyFrequency | "LIFETIME";
  const db = createEfficiencyQueryClient();

  try {
    if (mode === "personnel") {
      // Soft-path roster: only ACTIVE portal profiles linked to current HRIS merge users.
      // Excludes LEGACY_CONFLICT ticketing-only accounts and stale breakdown rows.
      const [activePortals, hrisUsers, directory] = await Promise.all([
        prismaPrimary.portalAccount.findMany({
          where: {
            accountStatus: "ACTIVE",
            mergedSourceUserId: { not: null },
          },
          select: { mergedSourceUserId: true, staffDesignatedCompany: { select: { name: true } } },
        }),
        db.mergedUser.findMany({
          where: {
            isActive: true,
            sourceDatabase: { in: resolveHrisSourceTags() },
          },
          select: { sourceUserId: true },
        }),
        loadCompanyDirectory(),
      ]);
      /** Report company = default membership, else the canonical HRIS company label. */
      const defaultCompanyByMergedId = new Map(
        activePortals
          .filter((p) => p.mergedSourceUserId != null && p.staffDesignatedCompany)
          .map((p) => [p.mergedSourceUserId!.toString(), p.staffDesignatedCompany!.name] as const),
      );
      const reportCompanyName = (sourceUserId: string, hrisCompany: string | null | undefined) =>
        defaultCompanyByMergedId.get(sourceUserId) ??
        directory.resolveLabel(hrisCompany)?.name ??
        hrisCompany ??
        null;

      const activePortalIds = new Set(
        activePortals
          .map((p) => p.mergedSourceUserId)
          .filter((id): id is bigint => id != null)
          .map((id) => id.toString()),
      );
      const hrisIds = new Set(hrisUsers.map((u) => u.sourceUserId.toString()));
      const allowedIds = [...activePortalIds].filter((id) => hrisIds.has(id));

      if (allowedIds.length === 0) {
        return NextResponse.json({
          periodKey,
          frequency,
          source: "mergedatabase",
          rows: [],
        });
      }

      const rows = await db.mergedUserEfficiencyBreakdown.findMany({
        where: {
          periodKey,
          frequency,
          sourceUserId: { in: allowedIds.map((id) => BigInt(id)) },
        },
        orderBy: [{ overallEfficiency: "desc" }, { displayName: "asc" }],
        include: { user: { select: { name: true, companyName: true, department: true, isActive: true, sourceDatabase: true } } },
      });

      type PersonnelRow = {
        sourceUserId: string;
        name: string;
        companyName: string | null;
        departmentName: string | null;
        totalTasks: number;
        completedTasks: number;
        delayedTasks: number;
        ticketsClosed: number;
        ticketsPending: number;
        taskEfficiency: number | null;
        ticketEfficiency: number | null;
        overallEfficiency: number;
        onTimeCompletionRate: number | null;
        delayPenaltyTotal: number;
        taskEfficiencyBeforePenalty: number | null;
        computedAt: string;
      };

      const byName = new Map<string, PersonnelRow>();
      for (const r of rows) {
        const row = r as typeof r & {
          ticketsClosed?: number;
          ticketsPending?: number;
          delayPenaltyTotal?: number;
          taskEfficiencyBeforePenalty?: unknown;
        };
        if (row.user && row.user.isActive === false) continue;
        const name = row.user?.name?.trim() || row.displayName;
        const key = name
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/,/g, " ")
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(Boolean)
          .sort()
          .join(" ");
        if (!key) continue;
        const mapped: PersonnelRow = {
          sourceUserId: row.sourceUserId.toString(),
          name,
          companyName: reportCompanyName(row.sourceUserId.toString(), row.user?.companyName),
          departmentName: row.user?.department?.trim() || null,
          totalTasks: row.totalTasks,
          completedTasks: row.completedTasks,
          delayedTasks: row.delayedTasks,
          ticketsClosed: Number(row.ticketsClosed ?? 0),
          ticketsPending: Number(row.ticketsPending ?? 0),
          taskEfficiency: row.taskEfficiency != null ? Number(row.taskEfficiency) : null,
          ticketEfficiency: row.ticketEfficiency != null ? Number(row.ticketEfficiency) : null,
          overallEfficiency: Number(row.overallEfficiency),
          onTimeCompletionRate:
            row.onTimeCompletionRate != null ? Number(row.onTimeCompletionRate) : null,
          delayPenaltyTotal: Number(row.delayPenaltyTotal ?? 0),
          taskEfficiencyBeforePenalty:
            row.taskEfficiencyBeforePenalty != null
              ? Number(row.taskEfficiencyBeforePenalty)
              : null,
          computedAt: row.computedAt.toISOString(),
        };
        const existing = byName.get(key);
        if (!existing) {
          byName.set(key, mapped);
          continue;
        }
        const preferMapped =
          mapped.totalTasks > existing.totalTasks ||
          (mapped.totalTasks === existing.totalTasks &&
            BigInt(mapped.sourceUserId) < BigInt(existing.sourceUserId));
        const canonical = preferMapped ? mapped : existing;
        const other = preferMapped ? existing : mapped;
        byName.set(key, {
          ...canonical,
          name: canonical.name.includes(",") ? canonical.name : other.name.includes(",") ? other.name : canonical.name,
          companyName: canonical.companyName ?? other.companyName,
          departmentName: canonical.departmentName ?? other.departmentName,
          totalTasks: Math.max(canonical.totalTasks, other.totalTasks),
          completedTasks: Math.max(canonical.completedTasks, other.completedTasks),
          delayedTasks: Math.max(canonical.delayedTasks, other.delayedTasks),
          ticketsClosed: Math.max(canonical.ticketsClosed, other.ticketsClosed),
          ticketsPending: Math.max(canonical.ticketsPending, other.ticketsPending),
          delayPenaltyTotal: Math.max(canonical.delayPenaltyTotal, other.delayPenaltyTotal),
          taskEfficiency: canonical.taskEfficiency ?? other.taskEfficiency,
          taskEfficiencyBeforePenalty:
            canonical.taskEfficiencyBeforePenalty ?? other.taskEfficiencyBeforePenalty,
          ticketEfficiency: canonical.ticketEfficiency ?? other.ticketEfficiency,
          overallEfficiency: Math.max(canonical.overallEfficiency, other.overallEfficiency),
        });
      }

      return NextResponse.json({
        periodKey,
        frequency,
        source: "mergedatabase",
        rows: [...byName.values()],
      });
    }

    if (mode === "leaderboard") {
      const limit = Number(searchParams.get("limit") ?? "50");
      const rows = await getEfficiencyLeaderboard(db, {
        periodKey,
        frequency,
        limit: Number.isFinite(limit) ? limit : 50,
      });
      return NextResponse.json({
        periodKey,
        frequency,
        source: "mergedatabase",
        rows: rows.map((r) => ({
          ...r,
          sourceUserId: r.sourceUserId.toString(),
          overallEfficiency: Number(r.overallEfficiency),
          taskEfficiency: r.taskEfficiency != null ? Number(r.taskEfficiency) : null,
          ticketEfficiency: r.ticketEfficiency != null ? Number(r.ticketEfficiency) : null,
          onTimeCompletionRate:
            r.onTimeCompletionRate != null ? Number(r.onTimeCompletionRate) : null,
        })),
      });
    }

    const sourceUserId = searchParams.get("sourceUserId")?.trim() ?? "";
    if (!/^\d+$/.test(sourceUserId)) {
      return NextResponse.json({ error: "sourceUserId is required." }, { status: 400 });
    }

    if (mode === "details") {
      const details = await getUserEfficiencyTaskBreakdown(db, {
        sourceUserId,
        periodKey,
        frequency,
      });
      return NextResponse.json({
        sourceUserId,
        periodKey,
        frequency,
        source: "mergedatabase",
        details: details.map((d: (typeof details)[number]) => ({
          ...d,
          efficiencyContribution:
            d.efficiencyContribution != null ? Number(d.efficiencyContribution) : null,
        })),
      });
    }

    const row = await getUserEfficiencyForPeriod(db, {
      sourceUserId,
      periodKey,
      frequency,
      includeDetails: searchParams.get("includeDetails") === "1",
    });
    if (!row) {
      return NextResponse.json({ error: "No breakdown for this user/period." }, { status: 404 });
    }
    return NextResponse.json({
      ...row,
      source: "mergedatabase",
      sourceUserId: row.sourceUserId.toString(),
      overallEfficiency: Number(row.overallEfficiency),
      taskEfficiency: row.taskEfficiency != null ? Number(row.taskEfficiency) : null,
      ticketEfficiency: row.ticketEfficiency != null ? Number(row.ticketEfficiency) : null,
      onTimeCompletionRate:
        row.onTimeCompletionRate != null ? Number(row.onTimeCompletionRate) : null,
      averageTaskCompletionHours:
        row.averageTaskCompletionHours != null
          ? Number(row.averageTaskCompletionHours)
          : null,
      efficiencyScore: row.efficiencyScore != null ? Number(row.efficiencyScore) : null,
      delayPenaltyTotal: row.delayPenaltyTotal ?? 0,
      taskEfficiencyBeforePenalty:
        row.taskEfficiencyBeforePenalty != null
          ? Number(row.taskEfficiencyBeforePenalty)
          : null,
    });
  } finally {
    await db.$disconnect();
  }
}
