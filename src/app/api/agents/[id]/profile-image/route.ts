import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { profileImageToBinaryResponse } from "@/lib/session-profile-image";

export const dynamic = "force-dynamic";

/**
 * Serve an agent's portal profile photo without embedding base64 in roster JSON.
 * Used by task board / assignee pickers (`AssigneeAvatar`).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { unauthorized } = await requireRole([
    "Admin",
    "Personnel",
    "SuperAdmin",
    "HighAdmin",
  ]);
  if (unauthorized) return unauthorized;

  const { id: agentId } = await ctx.params;
  const id = (agentId ?? "").trim();
  if (!id) {
    return new NextResponse(null, { status: 404 });
  }

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { email: true },
  });
  const email = agent?.email?.trim();
  if (!email) {
    return new NextResponse(null, { status: 404 });
  }

  const portal = await prisma.portalAccount.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { profileImage: true },
  });

  const binary = profileImageToBinaryResponse(portal?.profileImage);
  if (binary) {
    const hasVersion = new URL(req.url).searchParams.has("v");
    return new NextResponse(new Uint8Array(binary.bytes), {
      headers: {
        "Content-Type": binary.mime,
        // Versioned URLs can be cached briefly; unversioned stay fresh.
        "Cache-Control": hasVersion
          ? "private, max-age=300, stale-while-revalidate=600"
          : "private, no-store",
      },
    });
  }

  const stored = portal?.profileImage?.trim() ?? "";
  if (/^https?:\/\//i.test(stored)) {
    return NextResponse.redirect(stored);
  }

  return new NextResponse(null, { status: 404 });
}
