import { describe, expect, it } from "vitest";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";

describe("proceduralBoardAssigneeWrite", () => {
  it("connects when the current seat has an assignee", () => {
    expect(proceduralBoardAssigneeWrite("agent-b", "agent-a")).toEqual({
      assignedAgent: { connect: { id: "agent-b" } },
    });
  });

  it("no-ops when the board owner already matches the seat", () => {
    expect(proceduralBoardAssigneeWrite("agent-a", "agent-a")).toEqual({});
  });

  it("disconnects so the running-ticket icon clears when the MISSING seat has no assignee", () => {
    expect(proceduralBoardAssigneeWrite(null, "agent-a")).toEqual({
      assignedAgent: { disconnect: true },
    });
    expect(proceduralBoardAssigneeWrite("", "agent-a")).toEqual({
      assignedAgent: { disconnect: true },
    });
  });

  it("no-ops when already unassigned and the seat is empty", () => {
    expect(proceduralBoardAssigneeWrite(null, null)).toEqual({});
  });

  it("disconnects when approval is complete (no procedural seat left)", () => {
    expect(proceduralBoardAssigneeWrite(null, "last-approver")).toEqual({
      assignedAgent: { disconnect: true },
    });
  });
});
