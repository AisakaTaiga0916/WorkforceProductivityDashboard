import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  if (role !== "Admin" && role !== "Personnel" && role !== "HighAdmin") {
    return NextResponse.json({ designatedCompanyTeamId: null, designatedCompanyName: null }, { status: 200 });
  }

  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ designatedCompanyTeamId: null, designatedCompanyName: null }, { status: 200 });
  }

  const portal = await prisma.portalAccount.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      staffDesignatedCompanyId: true,
      staffDesignatedCompany: { select: { name: true } },
      companyId: true,
      company: { select: { name: true } },
    },
  });

  const designatedCompanyTeamId = portal?.staffDesignatedCompanyId ?? portal?.companyId ?? null;
  const designatedCompanyName =
    portal?.staffDesignatedCompany?.name?.trim() ?? portal?.company?.name?.trim() ?? null;

  return NextResponse.json({ designatedCompanyTeamId, designatedCompanyName }, { status: 200 });
}

