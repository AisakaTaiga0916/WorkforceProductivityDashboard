"use client";

import { useEffect, useState } from "react";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { TravelOrderSummaryPanel } from "@/components/task-board/TravelOrderSummaryPanel";

type TravelOrderApprovalModalProps = {
  open: boolean;
  taskId: string | null;
  travelOrderId: string | null;
  title?: string;
  description?: string;
  /** Prefer the board operator id when already known. */
  operatorAgentId?: string | null;
  canAssignWork?: boolean;
  canCheckIn?: boolean;
  onClose: () => void;
  onUpdated?: () => void;
};

/**
 * Popup for reviewing a travel order without requiring the KPI card on the
 * current Task Board (company list, notifications, cross-company approvers).
 */
export function TravelOrderApprovalModal({
  open,
  taskId,
  travelOrderId,
  title,
  description,
  operatorAgentId: operatorAgentIdProp = null,
  canAssignWork = false,
  canCheckIn = false,
  onClose,
  onUpdated,
}: TravelOrderApprovalModalProps) {
  const [fetchedOperatorAgentId, setFetchedOperatorAgentId] = useState<string | null>(null);
  const operatorAgentId = operatorAgentIdProp ?? fetchedOperatorAgentId;

  useEffect(() => {
    if (!open || operatorAgentIdProp) return;
    let ignore = false;
    void fetch("/api/me/permissions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { operatorAgentId?: string | null } | null) => {
        if (ignore) return;
        setFetchedOperatorAgentId(body?.operatorAgentId ?? null);
      })
      .catch(() => {
        if (!ignore) setFetchedOperatorAgentId(null);
      });
    return () => {
      ignore = true;
    };
  }, [open, operatorAgentIdProp]);

  return (
    <TaskBoardPopup
      open={open && Boolean(taskId)}
      title={title?.trim() || "Travel Order"}
      description={
        description?.trim() ||
        "View details and approvals for this travel order."
      }
      onClose={onClose}
      size="lg"
    >
      {taskId ? (
        <TravelOrderSummaryPanel
          taskId={taskId}
          focusTravelOrderId={travelOrderId}
          operatorAgentId={operatorAgentId}
          canAssignWork={canAssignWork}
          canCheckIn={canCheckIn}
          onKpiSubmitted={onUpdated}
        />
      ) : null}
    </TaskBoardPopup>
  );
}
