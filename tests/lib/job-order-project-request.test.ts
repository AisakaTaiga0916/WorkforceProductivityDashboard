import { describe, expect, it } from "vitest";
import {
  canViewerFulfillJobOrderProjectRequest,
  formatJobOrderProjectRequestDetail,
  jobOrderProjectRequestPendingFromActivities,
  parseJobOrderProjectRequestDetail,
  serializeJobOrderProjectRequest,
  JO_PROJECT_REQUESTED_SUMMARY,
  JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
  JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
} from "@/modules/requests/job-order-project-request";

describe("job order project request", () => {
  it("round-trips request payload", () => {
    const raw = serializeJobOrderProjectRequest({
      targetAdminAgentId: "admin-1",
      targetAdminAgentName: "Ada Admin",
      requestedByAgentId: "pers-1",
      requestedByAgentName: "Pat Personnel",
      note: "Need project for JO",
    });
    expect(parseJobOrderProjectRequestDetail(raw)).toEqual({
      targetAdminAgentId: "admin-1",
      targetAdminAgentName: "Ada Admin",
      requestedByAgentId: "pers-1",
      requestedByAgentName: "Pat Personnel",
      note: "Need project for JO",
    });
  });

  it("tracks pending from activity sequence", () => {
    expect(
      jobOrderProjectRequestPendingFromActivities([
        {
          summary: JO_PROJECT_REQUESTED_SUMMARY,
          detail: serializeJobOrderProjectRequest({
            targetAdminAgentId: "admin-1",
            targetAdminAgentName: "Ada",
          }),
        },
      ]).pending,
    ).toBe(true);

    expect(
      jobOrderProjectRequestPendingFromActivities([
        {
          summary: JO_PROJECT_REQUESTED_SUMMARY,
          detail: serializeJobOrderProjectRequest({ targetAdminAgentId: "admin-1" }),
        },
        { summary: JO_PROJECT_REQUEST_FULFILLED_SUMMARY, detail: "done" },
      ]).pending,
    ).toBe(false);

    expect(
      jobOrderProjectRequestPendingFromActivities([
        {
          summary: JO_PROJECT_REQUESTED_SUMMARY,
          detail: serializeJobOrderProjectRequest({ targetAdminAgentId: "admin-1" }),
        },
        { summary: JO_PROJECT_REQUEST_CANCELLED_SUMMARY, detail: "cancelled" },
        {
          summary: JO_PROJECT_REQUESTED_SUMMARY,
          detail: serializeJobOrderProjectRequest({
            targetAdminAgentId: "admin-2",
            targetAdminAgentName: "Bea",
          }),
        },
      ]),
    ).toEqual({
      pending: true,
      payload: expect.objectContaining({ targetAdminAgentId: "admin-2" }),
    });
  });

  it("allows target admin or SuperAdmin to fulfill", () => {
    const payload = { targetAdminAgentId: "admin-1", targetAdminAgentName: "Ada" };
    expect(
      canViewerFulfillJobOrderProjectRequest({
        sessionRole: "Admin",
        sessionAgentId: "admin-1",
        payload,
      }),
    ).toBe(true);
    expect(
      canViewerFulfillJobOrderProjectRequest({
        sessionRole: "Admin",
        sessionAgentId: "other",
        payload,
      }),
    ).toBe(false);
    expect(
      canViewerFulfillJobOrderProjectRequest({
        sessionRole: "SuperAdmin",
        sessionAgentId: "other",
        payload,
      }),
    ).toBe(true);
  });

  it("formats request detail for activity feeds", () => {
    expect(
      formatJobOrderProjectRequestDetail(
        serializeJobOrderProjectRequest({
          targetAdminAgentId: "admin-1",
          targetAdminAgentName: "Ada Admin",
          requestedByAgentId: "pers-1",
          requestedByAgentName: "Pat Personnel",
        }),
      ),
    ).toBe("Requested by Pat Personnel → Ada Admin");
  });
});
