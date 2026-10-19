import { describe, expect, it } from "vitest";
import { resolveTicketSendRequestToDisplay } from "@/modules/requests/ticket-send-to-display";

describe("resolveTicketSendRequestToDisplay", () => {
  it("uses company activity and label when send-to is company", () => {
    expect(
      resolveTicketSendRequestToDisplay({
        activities: [
          { summary: "Send request to company", detail: "AGCTEK" },
        ],
        orgChartSectionId: null,
      }),
    ).toEqual({
      label: "Send request to (company)",
      value: "AGCTEK",
    });
  });

  it("uses legacy department activity and the Team label when send-to is a team", () => {
    expect(
      resolveTicketSendRequestToDisplay({
        activities: [
          { summary: "Send request to department", detail: "IT Department" },
        ],
        orgChartSectionId: "sec-1",
        orgChartSectionName: "IT Department",
      }),
    ).toEqual({
      label: "Send request to (team)",
      value: "IT Department",
    });
  });

  it("falls back to team name for company-routed tickets without activity", () => {
    expect(
      resolveTicketSendRequestToDisplay({
        activities: [],
        orgChartSectionId: null,
        teamName: "ACI",
      }),
    ).toEqual({
      label: "Send request to (company)",
      value: "ACI",
    });
  });
});
