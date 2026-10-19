import { NextResponse } from "next/server";
import { listActiveCompanies } from "@/modules/platform/companies/company-directory";

/** Public list of active companies (customer signup, intake pickers). */
export async function GET() {
  return NextResponse.json(await listActiveCompanies());
}
