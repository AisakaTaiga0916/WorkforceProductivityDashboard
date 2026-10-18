import { NextResponse } from "next/server";
import { verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

function normalizeDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function PATCH(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { displayName?: string; password?: string };
  const displayName = normalizeDisplayName(body.displayName);
  const password = body.password ?? "";

  if (!displayName) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }
  if (displayName.length < 2 || displayName.length > 80) {
    return NextResponse.json({ error: "Display name must be 2-80 characters." }, { status: 400 });
  }

  const email = session.user.email.toLowerCase();
  const portal = await prisma.portalAccount.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }
  if (displayName === portal.name.trim()) {
    return NextResponse.json({ error: "Display name must be different." }, { status: 400 });
  }

  const auth = await verifyPortalPassword(portal.passwordHash, password);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === "PASSWORD_REQUIRED" ? "Current password is required." : "Incorrect password." },
      { status: 403 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.portalAccount.update({
      where: { id: portal.id },
      data: { name: displayName },
    });
    await tx.agent.updateMany({
      where: { email },
      data: { name: displayName },
    });
  });

  return NextResponse.json({ ok: true, displayName });
}
