import { NextResponse } from "next/server";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

/**
 * Portal profile metadata for the signed-in user (account age, optional agent resolve counts).
 */
export async function GET() {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email.toLowerCase();

  const [portal, agent] = await Promise.all([
    prisma.portalAccount.findUnique({
      where: { email },
      select: {
        name: true,
        username: true,
        createdAt: true,
        profileImage: true,
        profileImageZoom: true,
        profileImagePosX: true,
        profileImagePosY: true,
      },
    }),
    prisma.agent.findUnique({
      where: { email },
      select: { id: true },
    }),
  ]);

  let personalTicketsResolved: number | null = null;
  if (agent) {
    personalTicketsResolved = await prisma.ticket.count({
      where: {
        assignedAgentId: agent.id,
        status: { in: ["FOR_CONFIRMATION", "RESOLVED", "CLOSED"] },
      },
    });
  }

  return NextResponse.json({
    displayName: portal?.name ?? session.user.name ?? null,
    username: portal?.username ?? null,
    accountCreatedAt: portal?.createdAt?.toISOString() ?? null,
    profileImage: portal?.profileImage ?? null,
    profileImageZoom: portal?.profileImageZoom ?? 1,
    profileImagePosX: portal?.profileImagePosX ?? 50,
    profileImagePosY: portal?.profileImagePosY ?? 50,
    personalTicketsResolved,
    hasAgentProfile: !!agent,
  });
}
