import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { getCompanyAccess } from "@/modules/platform/scope/company-access";

/**
 * The staff user's current company (switcher context), used as the default
 * requesting company on intake forms. Field names are kept for existing clients.
 */
export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  if (role !== "Admin" && role !== "Personnel" && role !== "HighAdmin") {
    return NextResponse.json({ designatedCompanyTeamId: null, designatedCompanyName: null }, { status: 200 });
  }

  const access = await getCompanyAccess(session);
  const current = access.companies.find((c) => c.id === access.currentCompanyId) ?? null;
  return NextResponse.json(
    { designatedCompanyTeamId: current?.id ?? null, designatedCompanyName: current?.name ?? null },
    { status: 200 },
  );
}
