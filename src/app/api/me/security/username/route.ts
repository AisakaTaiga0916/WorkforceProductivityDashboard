import { NextResponse } from "next/server";
import { verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

function validUsername(username: string) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

export async function PATCH(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { newUsername?: string; password?: string };
  const newUsername = body.newUsername?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!newUsername) {
    return NextResponse.json({ error: "New username is required." }, { status: 400 });
  }
  if (!validUsername(newUsername)) {
    return NextResponse.json(
      { error: "Username must be 3-32 characters (letters, numbers, . _ -)." },
      { status: 400 },
    );
  }

  const currentEmail = session.user.email.toLowerCase();
  const portal = await prisma.portalAccount.findUnique({
    where: { email: currentEmail },
    select: { id: true, username: true, passwordHash: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }
  const currentUsername = (portal.username ?? "").toLowerCase();
  if (newUsername === currentUsername) {
    return NextResponse.json({ error: "New username must be different." }, { status: 400 });
  }

  const auth = await verifyPortalPassword(portal.passwordHash, password);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === "PASSWORD_REQUIRED" ? "Current password is required." : "Incorrect password." },
      { status: 403 },
    );
  }

  const existing = await prisma.portalAccount.findUnique({
    where: { username: newUsername },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
  }

  await prisma.portalAccount.update({
    where: { id: portal.id },
    data: { username: newUsername },
  });

  return NextResponse.json({ ok: true });
}
