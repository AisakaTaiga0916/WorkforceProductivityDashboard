/**
 * Sync the Request Board owner to the current procedural approval seat.
 * Empty seat → disconnect so the card icon clears (no stale prior assignee).
 */
export function proceduralBoardAssigneeWrite(
  boardAssigneeId: string | null | undefined,
  currentAssignedAgentId: string | null | undefined,
):
  | { assignedAgent: { connect: { id: string } } }
  | { assignedAgent: { disconnect: true } }
  | Record<string, never> {
  const next = typeof boardAssigneeId === "string" ? boardAssigneeId.trim() || null : null;
  const current =
    typeof currentAssignedAgentId === "string" ? currentAssignedAgentId.trim() || null : null;
  if (next) {
    if (next === current) return {};
    return { assignedAgent: { connect: { id: next } } };
  }
  if (current) {
    return { assignedAgent: { disconnect: true } };
  }
  return {};
}
