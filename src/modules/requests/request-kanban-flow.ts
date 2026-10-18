/** Shared preference: how request assignment kanban folders / drag flow are grouped. */

export type RequestKanbanFlowMode = "company" | "department";

export const REQUEST_KANBAN_FLOW_STORAGE_KEY = "request-kanban-flow-mode-v1";
export const REQUEST_KANBAN_FLOW_CHANGE_EVENT = "request-kanban-flow-change";

export function parseRequestKanbanFlowMode(raw: unknown): RequestKanbanFlowMode {
  return raw === "company" ? "company" : "department";
}

export function readRequestKanbanFlowMode(): RequestKanbanFlowMode {
  if (typeof window === "undefined") return "department";
  try {
    return parseRequestKanbanFlowMode(localStorage.getItem(REQUEST_KANBAN_FLOW_STORAGE_KEY));
  } catch {
    return "department";
  }
}

export function writeRequestKanbanFlowMode(mode: RequestKanbanFlowMode) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REQUEST_KANBAN_FLOW_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(REQUEST_KANBAN_FLOW_CHANGE_EVENT, { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}
