import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { ACTIVE_COMPANY_WHERE, COMPANY_ORDER_BY } from "@/modules/platform/companies/company-directory";

/** Active companies with their roster agents (legacy path name; these are companies, not org teams). */
export async function GET() {
  const { unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized) return unauthorized;
  const teams = await prisma.company.findMany({
    where: ACTIVE_COMPANY_WHERE,
    orderBy: COMPANY_ORDER_BY,
    include: { agents: true },
  });
  return NextResponse.json(teams);
}
