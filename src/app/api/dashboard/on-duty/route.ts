import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { loadOnDutySnapshot } from "@/lib/load-on-duty-snapshot";
import { resolveViewerOnDutyCompanyFilter } from "@/modules/platform/scope/staff-company-scope";
import { withTtlCache } from "@/lib/ttl-cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const pageSizeRaw = Number.parseInt(searchParams.get("pageSize") ?? "6", 10) || 6;
  const pageSize = Math.min(48, Math.max(1, pageSizeRaw));
  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10) || 1;
  let companyFilter = searchParams.get("company")?.trim() ?? "";
  const searchQuery = searchParams.get("q")?.trim() ?? "";
  const roleFilter = searchParams.get("role")?.trim() ?? "";

  // Non-global staff only see their current company (SuperAdmin keeps full company filter).
  const locked = await resolveViewerOnDutyCompanyFilter(session);
  if (locked) companyFilter = locked;

  const cacheKey = `on-duty:${session?.user?.role ?? "anon"}:${pageRaw}:${pageSize}:${companyFilter}:${searchQuery.toLowerCase()}:${roleFilter.toLowerCase()}`;
  const result = await withTtlCache(cacheKey, 10_000, () =>
    loadOnDutySnapshot({ page: pageRaw, pageSize, companyFilter, searchQuery, roleFilter }),
  );

  // When company-scoped, only expose the current company in the filter list.
  const companies =
    locked && companyFilter && companyFilter !== "__none__" ? [companyFilter] : result.companies;

  return NextResponse.json(
    { ...result, companies },
    {
      headers: { "cache-control": "private, max-age=10, stale-while-revalidate=20" },
    },
  );
}
