import { NextResponse } from "next/server";
import { isOAuthOnlyPortal, verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

const allowedRequestTypes = new Set(["SUSPENSION", "DELETION", "PASSWORD_RESET"]);

export async function GET() {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email.toLowerCase();
  const portal = await prisma.portalAccount.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!portal) return NextResponse.json({ rows: [] });

  const rows = await prisma.accountActionRequest.findMany({
    where: { portalAccountId: portal.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email.toLowerCase();
  const body = (await req.json()) as { requestType?: string; reason?: string; password?: string };
  const requestType = body.requestType?.toUpperCase() ?? "";
  const password = body.password ?? "";
  const reason = body.reason?.trim() ?? null;

  if (!allowedRequestTypes.has(requestType)) {
    return NextResponse.json({ error: "requestType is required." }, { status: 400 });
  }

  const portal = await prisma.portalAccount.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }

  if (requestType === "PASSWORD_RESET" && isOAuthOnlyPortal(portal.passwordHash)) {
    return NextResponse.json(
      { error: "Password reset does not apply to Google sign-in accounts." },
      { status: 400 },
    );
  }

  const auth = await verifyPortalPassword(portal.passwordHash, password);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === "PASSWORD_REQUIRED" ? "Password confirmation is required." : "Incorrect password." },
      { status: 403 },
    );
  }

  const duplicate = await prisma.accountActionRequest.findFirst({
    where: {
      portalAccountId: portal.id,
      status: "PENDING",
      requestType,
    },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "You already have a pending request of this type." },
      { status: 409 },
    );
  }

  const created = await prisma.accountActionRequest.create({
    data: {
      portalAccountId: portal.id,
      requestType,
      reason,
      status: "PENDING",
    },
  });
  return NextResponse.json(created, { status: 201 });
}
