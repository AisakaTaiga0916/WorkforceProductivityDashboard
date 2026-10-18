import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";

export async function GET() {
  const { unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized) return unauthorized;
  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: { agents: true },
  });
  return NextResponse.json(teams);
}
