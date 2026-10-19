import { NextResponse } from "next/server";
import { listAdminCompanies, updateCompany } from "@/modules/platform/companies/company-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/iam/companies/:id
 * Body: `{ name?, code?, aliases?, isActive? }`.
 * Field edits need `companies.update`; archive / restore (`isActive`) needs `companies.archive`.
 * There is no DELETE: archived companies keep their history.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const wantsFields = body.name !== undefined || body.code !== undefined || body.aliases !== undefined;
  const wantsArchive = body.isActive !== undefined;
  if (!wantsFields && !wantsArchive) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const needed: string[] = [];
  if (wantsFields) needed.push("companies.update");
  if (wantsArchive) needed.push("companies.archive");
  const { unauthorized } = await requirePermission(...(needed as [string, ...string[]]));
  if (unauthorized) return unauthorized;

  const result = await updateCompany(id, {
    name: body.name,
    code: body.code,
    aliases: body.aliases,
    isActive: body.isActive,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ company: result, companies: await listAdminCompanies() });
}
