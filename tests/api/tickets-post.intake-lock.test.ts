/**
 * Intake lock: POST /api/tickets returns 409 when the requestor already has an
 * **assigned** non-CLOSED ticket (see `src/modules/requests/customer-pending-resolution.ts`).
 * Unassigned tickets do not block a new submission.
 *
 * Manual smoke checklist (customer portal, signed in as requestor A):
 * 1. Create ticket T1 as A; have staff assign T1 → A opens /tickets/new → submit blocked (409 / UI banner).
 * 2. Unassign T1 (e.g. between RFP approval steps) → A can submit a new request.
 * 3. Close T1 while assigned → A can submit again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/modules/requests/ticket-intake-contact", () => ({
  IntakeContactError: class IntakeContactError extends Error {
    override name = "IntakeContactError";
  },
  isValidWorkEmail: vi.fn(() => true),
  resolveTicketContactFields: vi.fn().mockResolvedValue({
    contactEmail: "requestor@example.test",
    requestorEmail: "requestor@example.test",
  }),
}));

const { requestorHasIntakeBlockingTicketMock } = vi.hoisted(() => ({
  requestorHasIntakeBlockingTicketMock: vi.fn(),
}));

vi.mock("@/modules/requests/customer-pending-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/requests/customer-pending-resolution")>();
  return {
    ...actual,
    requestorHasIntakeBlockingTicket: requestorHasIntakeBlockingTicketMock,
  };
});

import { requireSession } from "@/lib/access";
import { POST } from "@/app/api/tickets/route";

describe("POST /api/tickets intake lock", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset();
    requestorHasIntakeBlockingTicketMock.mockReset();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(requireSession).mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
    expect(requestorHasIntakeBlockingTicketMock).not.toHaveBeenCalled();
  });

  it("returns 409 when requestor already has an intake-blocking ticket", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      expires: new Date(Date.now() + 3600_000).toISOString(),
      user: {
        email: "requestor@example.test",
        name: "Requestor",
        role: "Customer",
        authProvider: "google",
        companyId: "team-1",
      },
    });

    const updatedAt = new Date("2026-01-15T12:00:00.000Z");
    requestorHasIntakeBlockingTicketMock.mockResolvedValue({
      id: "ticket-blocking-1",
      ticketNumber: "REQ-1001",
      updatedAt,
      status: "IN_PROGRESS",
    });

    const res = await POST(
      new Request("http://localhost/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issue: "Second ticket" }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeTypeOf("string");
    expect(String(body.error)).toContain("Issue/Concern ticket");
    expect(body.pendingTicketId).toBe("ticket-blocking-1");
    expect(body.pendingTicketNumber).toBe("REQ-1001");

    expect(requestorHasIntakeBlockingTicketMock).toHaveBeenCalledTimes(1);
    expect(requestorHasIntakeBlockingTicketMock).toHaveBeenCalledWith(["requestor@example.test"]);
  });

  it("returns 409 for FOR_CONFIRMATION blocking ticket with same payload shape", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      expires: new Date(Date.now() + 3600_000).toISOString(),
      user: {
        email: "requestor@example.test",
        name: "Requestor",
        role: "Customer",
        authProvider: "google",
        companyId: "team-1",
      },
    });

    requestorHasIntakeBlockingTicketMock.mockResolvedValue({
      id: "ticket-blocking-2",
      ticketNumber: "REQ-2002",
      updatedAt: new Date(),
      status: "FOR_CONFIRMATION",
    });

    const res = await POST(
      new Request("http://localhost/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pendingTicketId).toBe("ticket-blocking-2");
    expect(String(body.error)).toContain("Issue/Concern ticket");
  });
});
