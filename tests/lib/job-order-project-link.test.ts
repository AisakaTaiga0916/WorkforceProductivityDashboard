import { describe, expect, it } from "vitest";
import {
  getLinkedJobOrderFromSubKpis,
  setLinkedJobOrderOnSubKpis,
  markProjectTask,
} from "@/modules/tasks/kpi-subkpis";

describe("job order project link envelope", () => {
  it("stores and clears linked Job Order meta on project subKpis", () => {
    const project = markProjectTask({ segmented: false, items: [] });
    const linked = setLinkedJobOrderOnSubKpis(project, {
      ticketId: "t1",
      ticketNumber: "JO-100",
    });
    expect(getLinkedJobOrderFromSubKpis(linked)).toEqual({
      ticketId: "t1",
      ticketNumber: "JO-100",
    });

    const cleared = setLinkedJobOrderOnSubKpis(linked, null);
    expect(getLinkedJobOrderFromSubKpis(cleared)).toBeNull();
    expect((cleared as Record<string, unknown>).linkedJobOrderTicketId).toBeUndefined();
  });
});
