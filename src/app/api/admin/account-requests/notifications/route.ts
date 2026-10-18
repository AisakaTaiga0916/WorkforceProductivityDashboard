import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";

export async function GET() {
  const { unauthorized } = await requireRole(["Admin"]);
  if (unauthorized) return unauthorized;

  const rows = await prisma.accountActionRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      portalAccount: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return NextResponse.json({ rows });
}
