import { NextResponse } from "next/server";
import { createCompany, listAdminCompanies } from "@/modules/platform/companies/company-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";

/** GET /api/admin/iam/companies (companies.read) — every company, archived included. */
export async function GET() {
  const { permissions, unauthorized } = await requirePermission("companies.read");
  if (unauthorized) return unauthorized;
  return NextResponse.json({
    companies: await listAdminCompanies(),
    viewerPermissions: [...(permissions ?? [])],
  });
}

/** POST /api/admin/iam/companies (companies.create) — body `{ name, code?, aliases? }`. */
export async function POST(req: Request) {
  const { unauthorized } = await requirePermission("companies.create");
  if (unauthorized) return unauthorized;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createCompany({ name: body.name, code: body.code, aliases: body.aliases });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ company: result, companies: await listAdminCompanies() }, { status: 201 });
}
