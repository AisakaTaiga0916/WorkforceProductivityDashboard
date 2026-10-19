import { NextResponse } from "next/server";
import { listAdminCompanies, reorderCompanies } from "@/modules/platform/companies/company-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";

/** PUT /api/admin/iam/companies/order (companies.update) — body `{ ids: string[] }` in display order. */
export async function PUT(req: Request) {
  const { unauthorized } = await requirePermission("companies.update");
  if (unauthorized) return unauthorized;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids must be a list of company ids." }, { status: 400 });
  }
  const error = await reorderCompanies(body.ids as string[]);
  if (error) return NextResponse.json(error, { status: 400 });
  return NextResponse.json({ companies: await listAdminCompanies() });
}
