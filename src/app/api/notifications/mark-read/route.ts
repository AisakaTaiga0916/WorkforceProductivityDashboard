import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { markStaffNotificationsRead } from "@/lib/staff-notifications";

export const dynamic = "force-dynamic";

/** Mark all staff notifications as read for the signed-in portal account. */
export async function POST() {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const email = session.user?.email?.trim() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Missing session email." }, { status: 400 });
  }

  const at = await markStaffNotificationsRead(email);
  return NextResponse.json(
    { ok: true, lastReadAt: at.toISOString() },
    { headers: { "cache-control": "private, no-store" } },
  );
}
