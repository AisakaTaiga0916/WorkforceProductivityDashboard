import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { getCompanyAccess } from "@/modules/platform/scope/company-access";

/**
 * Lightweight company list for Request / Task metrics filters (avoids heavy tracker queries).
 * Super Admin: every active company. Admin: their accessible companies, current first.
 */
export async function GET() {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const access = await getCompanyAccess(session);
  const companies = access.companies.map((c) => ({ id: c.id, name: c.name }));
  return NextResponse.json({ companies, currentCompanyId: access.currentCompanyId });
}
