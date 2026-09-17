import { describe, expect, it } from "vitest";
import {
  BOARD_LANE_OVERDUE_MS,
  isBoardLaneOverdue,
  overdueClockStartedAtMs,
} from "@/lib/sla-shared";

const dayAgo = Date.now() - BOARD_LANE_OVERDUE_MS - 60_000;
const hourAgo = Date.now() - 60 * 60 * 1000;

describe("overdueClockStartedAtMs / isBoardLaneOverdue", () => {
  it("ISSUE/CONCERN: uses board lane stamp; overdue after 24h without board updates", () => {
    const ticket = {
      status: "IN_PROGRESS" as const,
      requestType: "ISSUE_CONCERN_TICKET",
      boardLaneEnteredAt: new Date(dayAgo).toISOString(),
      updatedAt: new Date(hourAgo).toISOString(),
    };
    expect(overdueClockStartedAtMs(ticket)).toBe(dayAgo);
    expect(isBoardLaneOverdue(ticket)).toBe(true);
    expect(
      isBoardLaneOverdue({
        ...ticket,
        boardLaneEnteredAt: new Date(hourAgo).toISOString(),
      }),
    ).toBe(false);
  });

  it("JOB_ORDER: uses last audit-trail activity", () => {
    const ticket = {
      status: "IN_PROGRESS" as const,
      requestType: "JOB_ORDER",
      boardLaneEnteredAt: new Date(dayAgo).toISOString(),
      lastActivityAt: new Date(hourAgo).toISOString(),
      updatedAt: new Date(hourAgo).toISOString(),
    };
    expect(overdueClockStartedAtMs(ticket)).toBe(hourAgo);
    expect(isBoardLaneOverdue(ticket)).toBe(false);
    expect(
      isBoardLaneOverdue({
        ...ticket,
        lastActivityAt: new Date(dayAgo).toISOString(),
      }),
    ).toBe(true);
  });

  it("RFP/FTR/R.S./A.C.A.: only after FOR_CONFIRMATION", () => {
    for (const requestType of [
      "REQUEST_FOR_PAYMENT",
      "FUND_TRANSFER_REQUEST",
      "ITEM_REQUISITION_SLIP",
      "AUTHORITY_TO_CONDUCT_ACTIVITY",
    ] as const) {
      expect(
        overdueClockStartedAtMs({
          status: "IN_PROGRESS",
          requestType,
          boardLaneEnteredAt: new Date(dayAgo).toISOString(),
          forConfirmationAt: new Date(dayAgo).toISOString(),
        }),
      ).toBeNull();
      expect(
        isBoardLaneOverdue({
          status: "IN_PROGRESS",
          requestType,
          forConfirmationAt: new Date(dayAgo).toISOString(),
        }),
      ).toBe(false);

      const confirming = {
        status: "FOR_CONFIRMATION" as const,
        requestType,
        forConfirmationAt: new Date(dayAgo).toISOString(),
        boardLaneEnteredAt: new Date(hourAgo).toISOString(),
      };
      expect(overdueClockStartedAtMs(confirming)).toBe(dayAgo);
      expect(isBoardLaneOverdue(confirming)).toBe(true);
    }
  });

  it("CLOSED tickets never overdue", () => {
    expect(
      isBoardLaneOverdue({
        status: "CLOSED",
        requestType: "ISSUE_CONCERN_TICKET",
        boardLaneEnteredAt: new Date(dayAgo).toISOString(),
      }),
    ).toBe(false);
  });
});
