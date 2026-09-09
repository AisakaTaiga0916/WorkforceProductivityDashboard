import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-staff", () => ({
  portalCompanyAdminPrivilegesForEmail: vi.fn(),
}));
vi.mock("@/lib/staff-company-scope", () => ({
  resolveStaffCompanyTeamId: vi.fn(),
}));

import {
  adminOutsideCompanyScope,
  isCurrentPaymentStepAssignee,
  isTicketAssignee,
  personnelForbiddenForTicket,
} from "@/lib/ticket-staff-access";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";

const portalCompanyAdminPrivilegesForEmailMock = vi.mocked(
  portalCompanyAdminPrivilegesForEmail,
);
const resolveStaffCompanyTeamIdMock = vi.mocked(resolveStaffCompanyTeamId);

describe("isTicketAssignee", () => {
  it("matches operator id or email", () => {
    expect(
      isTicketAssignee({
        operatorId: "op-1",
        sessionEmail: "other@ex.com",
        ticket: { teamId: "t1", assignedAgentId: "op-1" },
      }),
    ).toBe(true);
    expect(
      isTicketAssignee({
        operatorId: "op-2",
        sessionEmail: "Agent@Ex.com",
        ticket: {
          teamId: "t1",
          assignedAgentId: "op-1",
          assignedAgent: { email: "agent@ex.com" },
        },
      }),
    ).toBe(true);
    expect(
      isTicketAssignee({
        operatorId: "op-2",
        sessionEmail: "x@ex.com",
        ticket: { teamId: "t1", assignedAgentId: "op-1" },
      }),
    ).toBe(false);
  });
});

describe("isCurrentPaymentStepAssignee", () => {
  it("returns false without meta or operator", () => {
    expect(
      isCurrentPaymentStepAssignee(
        { teamId: "t1", assignedAgentId: null, paymentApprovalMeta: null },
        "op-1",
      ),
    ).toBe(false);
    expect(
      isCurrentPaymentStepAssignee(
        {
          teamId: "t1",
          assignedAgentId: null,
          paymentApprovalMeta: { currentStepIndex: 0, steps: [] },
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("adminOutsideCompanyScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only constrains Admin role", async () => {
    expect(
      await adminOutsideCompanyScope({
        role: "SuperAdmin",
        email: "a@ex.com",
        ticketTeamId: "other",
      }),
    ).toBe(false);
    expect(resolveStaffCompanyTeamIdMock).not.toHaveBeenCalled();
  });

  it("blocks Admin when ticket company differs from scoped company", async () => {
    resolveStaffCompanyTeamIdMock.mockResolvedValue("company-a");
    expect(
      await adminOutsideCompanyScope({
        role: "Admin",
        email: "a@ex.com",
        ticketTeamId: "company-b",
      }),
    ).toBe(true);
    expect(
      await adminOutsideCompanyScope({
        role: "Admin",
        email: "a@ex.com",
        ticketTeamId: "company-a",
      }),
    ).toBe(false);
  });

  it("blocks Admin with no company scope", async () => {
    resolveStaffCompanyTeamIdMock.mockResolvedValue(null);
    expect(
      await adminOutsideCompanyScope({
        role: "Admin",
        email: "a@ex.com",
        ticketTeamId: "company-a",
      }),
    ).toBe(true);
  });
});

describe("personnelForbiddenForTicket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows ticket assignee", async () => {
    expect(
      await personnelForbiddenForTicket({
        email: "a@ex.com",
        operatorId: "op-1",
        ticket: { teamId: "t1", assignedAgentId: "op-1" },
      }),
    ).toBe(false);
    expect(portalCompanyAdminPrivilegesForEmailMock).not.toHaveBeenCalled();
  });

  it("forbids peer who is neither assignee nor company coordinator", async () => {
    portalCompanyAdminPrivilegesForEmailMock.mockResolvedValue(false);
    expect(
      await personnelForbiddenForTicket({
        email: "peer@ex.com",
        operatorId: "op-peer",
        ticket: { teamId: "t1", assignedAgentId: "op-1" },
      }),
    ).toBe(true);
  });

  it("allows Job Order Seek Assistance assignee", async () => {
    expect(
      await personnelForbiddenForTicket({
        email: "helper@ex.com",
        operatorId: "assist-1",
        ticket: {
          teamId: "t1",
          assignedAgentId: "op-1",
          jobOrderApprovalMeta: {
            proceduralStep: "APPROVED_BY_2",
            completed: {},
            assistanceTeam: {
              scopeMode: "department",
              orgChartSectionId: "sec-1",
              companyTeamId: null,
              assigneeAgentId: "assist-1",
              workerAgentIds: [],
            },
          },
        },
      }),
    ).toBe(false);
  });
});
