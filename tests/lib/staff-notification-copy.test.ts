import { describe, expect, it } from "vitest";
import {
  formatTicketActivityNotificationTitle,
  groupStaffNotifTimeBucket,
  isNotifiableTicketActivity,
  staffNotifCategoryForKind,
} from "@/lib/staff-notification-copy";

describe("staff-notification-copy", () => {
  it("allows notable activity summaries and rejects intake field noise", () => {
    expect(isNotifiableTicketActivity("Ticket logged")).toBe(true);
    expect(isNotifiableTicketActivity("Status → IN_PROGRESS")).toBe(true);
    expect(isNotifiableTicketActivity("Manual assignment")).toBe(true);
    expect(isNotifiableTicketActivity("Payment approval pending")).toBe(true);
    expect(isNotifiableTicketActivity("Payee")).toBe(false);
    expect(isNotifiableTicketActivity("Bank name")).toBe(false);
    expect(isNotifiableTicketActivity("Request type")).toBe(false);
  });

  it("formats human-first titles", () => {
    expect(formatTicketActivityNotificationTitle("Ticket logged", null)).toBe(
      "New request submitted",
    );
    expect(formatTicketActivityNotificationTitle("Status → FOR_CONFIRMATION", null)).toBe(
      "Moved to For Confirmation",
    );
    expect(
      formatTicketActivityNotificationTitle("Manual assignment", "Assigned to Jane Doe"),
    ).toBe("Assigned to Jane Doe");
  });

  it("maps kinds to filter categories", () => {
    expect(staffNotifCategoryForKind("ticket")).toBe("requests");
    expect(staffNotifCategoryForKind("travel_approval")).toBe("action");
    expect(staffNotifCategoryForKind("phase_delay")).toBe("action");
  });

  it("buckets timestamps into today vs earlier", () => {
    const now = new Date("2026-09-25T15:00:00.000Z").getTime();
    expect(groupStaffNotifTimeBucket(new Date(now - 60_000).toISOString(), now)).toBe("today");
    expect(groupStaffNotifTimeBucket(new Date(now - 3 * 86400_000).toISOString(), now)).toBe(
      "earlier",
    );
  });
});
