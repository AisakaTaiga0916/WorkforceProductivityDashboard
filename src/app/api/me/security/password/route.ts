import { NextResponse } from "next/server";
import {
  setLinkedAccountPassword,
  verifyLinkedAccountPassword,
} from "@/modules/platform/auth/linked-account-password";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

export async function PATCH(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  const email = session.user.email.toLowerCase();
  const portal = await prisma.portalAccount.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, mergedSourceUserId: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current password and new password are required." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "New password must be different from current password." }, { status: 400 });
  }

  const check = await verifyLinkedAccountPassword(portal, currentPassword);
  if (!check.ok) {
    if (check.reason === "OAUTH_ONLY") {
      return NextResponse.json(
        { error: "Password changes are not available for Google sign-in accounts." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Incorrect current password." }, { status: 403 });
  }

  await setLinkedAccountPassword(portal, newPassword);
  return NextResponse.json({ ok: true });
}
