import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/modules/requests/customer-pending-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/requests/customer-pending-resolution")>();
  return {
    ...actual,
    customerHasPendingResolvedTicket: vi.fn(),
    listTicketsAwaitingCustomerConfirmation: vi.fn(),
  };
});

import { requireSession } from "@/lib/access";
import {
  customerHasPendingResolvedTicket,
  listTicketsAwaitingCustomerConfirmation,
} from "@/modules/requests/customer-pending-resolution";
import { GET as intakeLockGet } from "@/app/api/me/intake-lock/route";
import { GET as pendingConfirmationGet } from "@/app/api/me/pending-confirmation/route";

describe("deep check: requestor API routes", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset();
    vi.mocked(customerHasPendingResolvedTicket).mockReset();
    vi.mocked(listTicketsAwaitingCustomerConfirmation).mockReset();
  });

  it("intake-lock returns canCreateTickets=false when pending confirmation exists (Admin)", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      expires: new Date(Date.now() + 1_800_000).toISOString(),
      user: {
        email: "admin@test.local",
        name: "Admin",
        role: "Admin",
        authProvider: "credentials",
        companyId: null,
        companyName: null,
        customerOrgRole: null,
        staffRoleLabel: null,
        image: null,
      },
    });
    vi.mocked(customerHasPendingResolvedTicket).mockResolvedValue({
      id: "t1",
      ticketNumber: "REQ-1",
      status: "FOR_CONFIRMATION",
      updatedAt: new Date(),
    });

    const res = await intakeLockGet();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.canCreateTickets).toBe(false);
    expect(body.pendingConfirmation?.ticketId).toBe("t1");
  });

  it("pending-confirmation lists tickets for Personnel requestor", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      expires: new Date(Date.now() + 1_800_000).toISOString(),
      user: {
        email: "personnel@test.local",
        name: "Personnel",
        role: "Personnel",
        authProvider: "credentials",
        companyId: null,
        companyName: null,
        customerOrgRole: null,
        staffRoleLabel: null,
        image: null,
      },
    });
    vi.mocked(listTicketsAwaitingCustomerConfirmation).mockResolvedValue([
      {
        id: "t2",
        ticketNumber: "REQ-2",
        title: "Printer issue",
        status: "FOR_CONFIRMATION",
        remarks: null,
        updatedAt: new Date("2026-06-01T12:00:00.000Z"),
      },
    ]);

    const res = await pendingConfirmationGet();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0].verificationHref).toContain("/tickets/t2/verification");
  });

  it("intake-lock skips blocking check for non-requestor roles", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      expires: new Date(Date.now() + 1_800_000).toISOString(),
      user: {
        email: "nobody@test.local",
        name: "Nobody",
        // Unknown/legacy role string: not a ticket requestor, so the check is skipped.
        role: "Agent" as unknown as import("@/modules/platform/auth").UserRole,
        authProvider: null,
        companyId: null,
        companyName: null,
        customerOrgRole: null,
        staffRoleLabel: null,
        image: null,
      },
    });

    const res = await intakeLockGet();
    const body = await res.json();
    expect(body.canCreateTickets).toBe(true);
    expect(customerHasPendingResolvedTicket).not.toHaveBeenCalled();
  });
});

describe("deep check: session max age constant", () => {
  it("auth uses the 24h JWT cap with midnight session expiry for all roles", async () => {
    const auth = await import("@/modules/platform/auth");
    const policy = await import("@/lib/session-expiry-policy");
    expect(auth.authOptions.session?.maxAge).toBe(policy.SESSION_JWT_MAX_AGE_SECONDS);
    expect(auth.authOptions.jwt?.maxAge).toBe(policy.SESSION_JWT_MAX_AGE_SECONDS);
    expect(policy.SESSION_JWT_MAX_AGE_SECONDS).toBe(24 * 60 * 60);
    expect(policy.isMidnightLogoutRole("Personnel")).toBe(true);
    expect(policy.isMidnightLogoutRole("Customer")).toBe(true);
  });
});
