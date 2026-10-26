import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access", () => ({
  requireRole: vi.fn(),
}));

import { requireRole } from "@/lib/access";
import { GET as taskMetricsGet } from "@/app/api/kpis/task-metrics/route";

const AGC = "3fe47d9d-b558-42ad-8cee-d84752f883b1";

const superAdminSession = {
  expires: new Date(Date.now() + 1_800_000).toISOString(),
  user: {
    email: "admin@test.local",
    name: "Admin",
    role: "SuperAdmin" as const,
    authProvider: "credentials" as const,
    companyId: null,
    companyName: null,
    customerOrgRole: null,
    staffRoleLabel: null,
    image: null,
  },
};

describe("task KPI metrics API integration (Work → Reports → Tasks)", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({
      session: superAdminSession,
      unauthorized: null,
    });
  });

  it("GET /api/kpis/task-metrics returns 200 for AGC company", async () => {
    const res = await taskMetricsGet(
      new Request(
        `http://localhost/api/kpis/task-metrics?from=2026-06-01&to=2026-06-21&helpdeskCadence=MONTHLY&tz=Asia/Manila&companyId=${AGC}`,
      ),
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`status ${res.status}: ${text.slice(0, 500)}`);
    }
    const body = await res.json();
    expect(body.taskMetricsHelpdesk).toBeDefined();
    expect(body.taskChecklistPillars).toBeDefined();
  });
});
