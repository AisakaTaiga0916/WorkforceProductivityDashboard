import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { loadStaffNotificationUnreadCount } from "@/lib/staff-notifications";
import { runForConfirmationReminderSweep } from "@/lib/confirmation-reminders";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  void runForConfirmationReminderSweep().catch((error) => {
    console.error("Confirmation reminder sweep failed", error);
  });

  const { total, lastReadAt } = await loadStaffNotificationUnreadCount(session);

  return NextResponse.json(
    {
      total,
      lastReadAt,
      // Backward-compatible aliases used by older clients.
      ticketCount: 0,
      accountRequestCount: 0,
      travelOrderApprovalCount: 0,
      travelOrderApprovalIds: [] as string[],
      travelOrderConfirmationCount: 0,
      travelOrderConfirmationIds: [] as string[],
    },
    {
      headers: { "cache-control": "private, no-store" },
    },
  );
}
