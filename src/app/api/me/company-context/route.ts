import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { safeGetServerSession } from "@/lib/server-session";
import {
  ALL_COMPANIES_VALUE,
  CURRENT_COMPANY_COOKIE,
  canAccessCompany,
  getCompanyAccess,
} from "@/modules/platform/scope/company-access";
import { encodeCompanyContextCookie } from "@/modules/platform/scope/company-access-core";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** GET /api/me/company-context — switcher options (memberships; all active companies for Super Admin). */
export async function GET() {
  const session = await safeGetServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getCompanyAccess(session);
  return NextResponse.json({
    companies: access.companies,
    currentCompanyId: access.currentCompanyId,
    defaultCompanyId: access.defaultCompanyId,
    global: access.global,
  });
}

/**
 * POST /api/me/company-context — body `{ companyId: string | "all" }`.
 * Only companies the user can access; `"all"` is Super Admin only. Remembered
 * in a cookie bound to the account (cleared at sign-in, so login opens the default).
 */
export async function POST(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { companyId?: unknown };
  const requested = typeof body.companyId === "string" ? body.companyId.trim() : "";

  const access = await getCompanyAccess(session);
  if (!access.portalAccountId) {
    return NextResponse.json({ error: "No account for this session." }, { status: 403 });
  }
  let companyId: string | null;
  if (requested === ALL_COMPANIES_VALUE) {
    if (!access.global) {
      return NextResponse.json({ error: "Only a Super Admin can view all companies." }, { status: 403 });
    }
    companyId = null;
  } else if (
    requested &&
    canAccessCompany(access, requested) &&
    access.companies.some((c) => c.id === requested)
  ) {
    companyId = requested;
  } else {
    return NextResponse.json({ error: "You do not have access to that company." }, { status: 403 });
  }

  (await cookies()).set(CURRENT_COMPANY_COOKIE, encodeCompanyContextCookie(access.portalAccountId, companyId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return NextResponse.json({ currentCompanyId: companyId });
}
