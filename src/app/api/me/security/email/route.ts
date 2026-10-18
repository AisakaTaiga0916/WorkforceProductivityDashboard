import { NextResponse } from "next/server";
import { verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

export async function PATCH(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { newEmail?: string; password?: string };
  const newEmail = body.newEmail?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!newEmail || !newEmail.includes("@")) {
    return NextResponse.json({ error: "New email is required." }, { status: 400 });
  }

  const currentEmail = session.user.email.toLowerCase();
  if (newEmail === currentEmail) {
    return NextResponse.json({ error: "New email must be different." }, { status: 400 });
  }

  const portal = await prisma.portalAccount.findUnique({
    where: { email: currentEmail },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }

  const auth = await verifyPortalPassword(portal.passwordHash, password);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === "PASSWORD_REQUIRED" ? "Current password is required." : "Incorrect password." },
      { status: 403 },
    );
  }

  const existing = await prisma.portalAccount.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "Email already in use." }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.portalAccount.update({
      where: { id: portal.id },
      data: { email: newEmail },
    });
    await tx.agent.updateMany({
      where: { email: currentEmail },
      data: { email: newEmail },
    });
  });

  return NextResponse.json({ ok: true });
}
