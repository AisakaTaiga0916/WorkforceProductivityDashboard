/** Maps a travel order's hierarchical approval levels into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";

export type TravelOrderApprovalStepLevel = {
  level: number;
  agentId?: string | null;
  agent?: { name?: string | null } | null;
  approvedAt?: string | null;
};

export function travelOrderApprovalUiSteps(args: {
  levels: TravelOrderApprovalStepLevel[];
  actionableLevel?: number | null;
}): ApprovalStep[] {
  const { levels, actionableLevel = null } = args;
  const firstIncomplete = levels.find((lvl) => !lvl.approvedAt);
  return levels.map((lvl) => {
    const approvedAt = lvl.approvedAt ?? null;
    const state: ApprovalStep["state"] = approvedAt
      ? "done"
      : actionableLevel != null
        ? lvl.level === actionableLevel
          ? "current"
          : "upcoming"
        : firstIncomplete?.level === lvl.level
          ? "current"
          : "upcoming";
    return {
      id: `LEVEL_${lvl.level}`,
      label: `LEVEL ${lvl.level} APPROVAL`,
      state,
      actorName: lvl.agent?.name?.trim() || lvl.agentId || null,
      decidedAt: approvedAt,
    };
  });
}
