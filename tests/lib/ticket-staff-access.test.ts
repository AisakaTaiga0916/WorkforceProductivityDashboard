import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-staff", () => ({
  portalCompanyAdminPrivilegesForEmail: vi.fn(),
}));
vi.mock("@/modules/platform/scope/staff-company-scope", () => ({
  resolveStaffCompanyTeamId: vi.fn(),
  resolveStaffCompanyIds: vi.fn(),
}));
vi.mock("@/modules/platform/scope/org-chart-section-scope", () => ({
  roleUsesOrgChartSectionBoardScope: (role: string) =>
    role === "Admin" || role === "HighAdmin" || role === "Personnel",
  ticketInViewerSectionScope: vi.fn(async (input: { teamId?: string | null; email?: string | null }) => {
    const { resolveStaffCompanyIds } = await import("@/modules/platform/scope/staff-company-scope");
    const companies = await resolveStaffCompanyIds(input.email);
    return Boolean(input.teamId && (companies ?? []).includes(input.teamId));
  }),
}));

import {
  adminOutsideCompanyScope,
  isCurrentPaymentStepAssignee,
  isTicketAssignee,
  personnelForbiddenForTicket,
} from "@/modules/requests/ticket-staff-access";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { resolveStaffCompanyIds } from "@/modules/platform/scope/staff-company-scope";

const portalCompanyAdminPrivilegesForEmailMock = vi.mocked(
  portalCompanyAdminPrivilegesForEmail,
);
const resolveStaffCompanyIdsMock = vi.mocked(resolveStaffCompanyIds);

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
    expect(resolveStaffCompanyIdsMock).not.toHaveBeenCalled();
  });

  it("blocks Admin when ticket company is not one of their companies", async () => {
    resolveStaffCompanyIdsMock.mockResolvedValue(["company-a"]);
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

  it("allows a multi-company Admin on any of their companies", async () => {
    resolveStaffCompanyIdsMock.mockResolvedValue(["company-a", "company-b"]);
    expect(
      await adminOutsideCompanyScope({
        role: "Admin",
        email: "a@ex.com",
        ticketTeamId: "company-b",
      }),
    ).toBe(false);
  });

  it("blocks Admin with no company scope", async () => {
    resolveStaffCompanyIdsMock.mockResolvedValue([]);
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
    resolveStaffCompanyIdsMock.mockResolvedValue([]);
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
