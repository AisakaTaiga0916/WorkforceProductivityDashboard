import { NextResponse } from "next/server";
import { prisma } from "@/modules/platform/db/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const GENERIC_OK = {
  ok: true,
  message:
    "If an account matches that username or email, your request was sent to the SuperAdmin for review.",
};

/**
 * Public endpoint reachable from the sign-in page so a user who has lost their
 * password can request a reset without first authenticating. The request is
 * persisted as a PASSWORD_RESET AccountActionRequest with PENDING status. A
 * SuperAdmin grants or denies the request from the Personnel registry; on
 * approval the password is reset to DEFAULT_PASSWORD_RESET.
 *
 * Responses are deliberately uniform to avoid revealing which usernames/emails
 * exist in the system (account enumeration protection).
 */
export async function POST(req: Request) {
  let body: { identifier?: string; reason?: string };
  try {
    body = (await req.json()) as { identifier?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const identifier = body.identifier?.trim() ?? "";
  const reason = body.reason?.trim() || null;
  if (!identifier) {
    return NextResponse.json({ error: "Enter your username or email." }, { status: 400 });
  }

  const ip = clientIp(req);
  const lim = await rateLimit({
    key: `pwreset:${ip}:${identifier.toLowerCase()}`,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!lim.allowed) {
    return NextResponse.json(
      { error: "Too many reset requests. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const portal = await prisma.portalAccount.findFirst({
    where: {
      OR: [
        { email: { equals: identifier, mode: "insensitive" } },
        { username: { equals: identifier, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });

  if (!portal) {
    /** Do not leak that the account is missing; respond identically to a success. */
    return NextResponse.json(GENERIC_OK);
  }

  const duplicate = await prisma.accountActionRequest.findFirst({
    where: {
      portalAccountId: portal.id,
      requestType: "PASSWORD_RESET",
      status: "PENDING",
    },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({
      ok: true,
      message: "A password reset request is already pending for this account.",
    });
  }

  await prisma.accountActionRequest.create({
    data: {
      portalAccountId: portal.id,
      requestType: "PASSWORD_RESET",
      reason: reason ?? "Self-service request from sign-in page.",
      status: "PENDING",
    },
  });

  return NextResponse.json(GENERIC_OK);
}
