"use client";

import type { TicketPriority, TicketStatus } from "@prisma/client/primary";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CompanyBoardColumn,
  CompanyBucketId,
  CompanyTicketCard,
  DepartmentBoardBreadcrumb,
} from "@/lib/company-board";
import { companyLogoApiPath } from "@/lib/company-logo-url";
import { cn } from "@/lib/cn";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import {
  readRequestKanbanFlowMode,
  REQUEST_KANBAN_FLOW_CHANGE_EVENT,
  REQUEST_KANBAN_FLOW_STORAGE_KEY,
  type RequestKanbanFlowMode,
} from "@/lib/request-kanban-flow";
import { priorityPillClass } from "@/lib/ticket-board-formatters";
import { formatCompanyBoardStatusLabel } from "@/lib/ticket-status-label";

const PRIORITY_ORDER: TicketPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "UNSET"];

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNSET: "Set priority",
};

const BUCKET_ORDER: CompanyBucketId[] = [
  "unassigned",
  "in_progress",
  "for_confirmation",
  "closed",
];

const BUCKET_LABELS: Record<CompanyBucketId, string> = {
  unassigned: "Unassigned",
  in_progress: "In progress",
  for_confirmation: "For confirmation",
  closed: "Closed",
};

function statusForFocusBucket(bucket: CompanyBucketId): TicketStatus {
  if (bucket === "closed") return "CLOSED";
  if (bucket === "for_confirmation") return "FOR_CONFIRMATION";
  if (bucket === "unassigned") return "OPEN";
  return "IN_PROGRESS";
}

function focusBucketForTicket(ticket: CompanyTicketCard): CompanyBucketId {
  if (ticket.status === "CLOSED") return "closed";
  if (ticket.status === "FOR_CONFIRMATION" || ticket.status === "RESOLVED") {
    return "for_confirmation";
  }
  if (!ticket.assignedAgentId) return "unassigned";
  return "in_progress";
}

function emptyFocusBuckets(): Record<CompanyBucketId, CompanyTicketCard[]> {
  return { unassigned: [], in_progress: [], for_confirmation: [], closed: [] };
}

function rebuildFocusBuckets(
  tickets: CompanyTicketCard[],
): Record<CompanyBucketId, CompanyTicketCard[]> {
  const next = emptyFocusBuckets();
  for (const ticket of tickets) {
    next[focusBucketForTicket(ticket)].push(ticket);
  }
  return next;
}

function useKanbanFlowActiveForView(boardLayer: "company" | "department") {
  const [flowMode, setFlowMode] = useState<RequestKanbanFlowMode>("department");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setFlowMode(readRequestKanbanFlowMode());
    sync();
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === REQUEST_KANBAN_FLOW_STORAGE_KEY || e.key === null) sync();
    };
    const onLocal = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(REQUEST_KANBAN_FLOW_CHANGE_EVENT, onLocal);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REQUEST_KANBAN_FLOW_CHANGE_EVENT, onLocal);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return ready && flowMode === boardLayer;
}

const CARD_ORDER_STORAGE_KEY = "company-board-card-order-v2";
const DEPT_CARD_ORDER_STORAGE_KEY = "department-board-card-order-v1";
const LEGACY_CARD_ORDER_STORAGE_KEY = "company-board-card-order-v1";
const DRAG_MIME = "application/x-company-board-team-id";

type PriorityModalState = {
  companyName: string;
  priority: TicketPriority;
  tickets: CompanyTicketCard[];
};

function statusPillClass(status: string) {
  if (status === "OPEN") {
    return "bg-sky-500/15 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200";
  }
  if (status === "IN_PROGRESS") {
    return "bg-indigo-500/15 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200";
  }
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED") {
    return "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200";
  }
  if (status === "ESCALATED") {
    return "bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200";
  }
  if (status === "PENDING_INFO") {
    return "bg-violet-500/15 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200";
  }
  return "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200";
}

const TICKETS_PAGE_SIZE = 15;

function ticketsForColumn(col: CompanyBoardColumn): CompanyTicketCard[] {
  const merged = [
    ...col.buckets.unassigned,
    ...col.buckets.in_progress,
    ...col.buckets.for_confirmation,
    ...col.buckets.closed,
  ];
  return merged.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function ticketsByPriority(tickets: CompanyTicketCard[]): Partial<Record<TicketPriority, CompanyTicketCard[]>> {
  const grouped: Partial<Record<TicketPriority, CompanyTicketCard[]>> = {};
  for (const ticket of tickets) {
    const list = grouped[ticket.priority] ?? [];
    list.push(ticket);
    grouped[ticket.priority] = list;
  }
  return grouped;
}

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function mergeOrderWithColumns(orderIds: string[], columnIds: string[]): string[] {
  return [
    ...orderIds.filter((id) => columnIds.includes(id)),
    ...columnIds.filter((id) => !orderIds.includes(id)),
  ];
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function readStoredSavedOrder(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
      }
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { saved?: unknown }).saved)) {
        return ((parsed as { saved: unknown[] }).saved).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        );
      }
    }
    if (storageKey === CARD_ORDER_STORAGE_KEY) {
      const legacy = localStorage.getItem(LEGACY_CARD_ORDER_STORAGE_KEY);
      if (!legacy) return [];
      const parsedLegacy = JSON.parse(legacy) as unknown;
      if (!Array.isArray(parsedLegacy)) return [];
      return parsedLegacy.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

function writeStoredSavedOrder(storageKey: string, ids: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ saved: ids }));
    if (storageKey === CARD_ORDER_STORAGE_KEY) {
      localStorage.removeItem(LEGACY_CARD_ORDER_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function applyCardOrder(columns: CompanyBoardColumn[], orderIds: string[]): CompanyBoardColumn[] {
  if (orderIds.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.teamId, c]));
  const ordered: CompanyBoardColumn[] = [];
  for (const id of orderIds) {
    const col = byId.get(id);
    if (!col) continue;
    ordered.push(col);
    byId.delete(id);
  }
  for (const col of columns) {
    if (byId.has(col.teamId)) ordered.push(col);
  }
  return ordered;
}

function moveTeamId(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const next = [...order];
  const fromIdx = next.indexOf(fromId);
  const toIdx = next.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0) return order;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, fromId);
  return next;
}

export function CompanyKanban({
  columns,
  refreshSeconds = 30,
  boardLayer = "company",
  breadcrumb = [],
  overviewHref,
  sectionHrefTemplate: _sectionHrefTemplate,
}: {
  columns: CompanyBoardColumn[];
  refreshSeconds?: number;
  boardLayer?: "company" | "department";
  breadcrumb?: DepartmentBoardBreadcrumb[];
  /** Link back to department majors (clears section). */
  overviewHref?: string;
  /**
   * @deprecated Drill URLs are built on the client now. Kept for call-site compat.
   */
  sectionHrefTemplate?: string;
}) {
  void _sectionHrefTemplate;
  const router = useRouter();
  /** Client-built drill URL (ignore server `__SECTION__` template — encoding broke navigation). */
  const sectionHref = useCallback((sectionId: string) => {
    const qs = new URLSearchParams();
    qs.set("board", "company");
    qs.set("layer", "department");
    qs.set("section", sectionId);
    if (typeof window !== "undefined") {
      const current = new URLSearchParams(window.location.search);
      const company = current.get("company");
      if (company && company !== "ALL") qs.set("company", company);
      const priority = current.get("priority");
      if (priority && priority !== "ALL") qs.set("priority", priority);
      const requestType = current.get("requestType");
      if (requestType && requestType !== "ALL") qs.set("requestType", requestType);
      const sentBy = current.get("sentBy");
      if (sentBy && sentBy !== "ALL") qs.set("sentBy", sentBy);
      const received = current.get("received");
      if (received && received !== "ALL") qs.set("received", received);
    }
    return `/agent?${qs.toString()}`;
  }, []);
  const drillToSection = useCallback(
    (sectionId: string) => {
      router.push(sectionHref(sectionId));
    },
    [router, sectionHref],
  );
  const canDrillSections = boardLayer === "department";
  const [modalState, setModalState] = useState<PriorityModalState | null>(null);
  const [savedOrderIds, setSavedOrderIds] = useState<string[]>([]);
  const [draftOrderIds, setDraftOrderIds] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [orderReady, setOrderReady] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [kanbanFocusId, setKanbanFocusId] = useState<string | null>(null);

  const orderStorageKey =
    boardLayer === "department" ? DEPT_CARD_ORDER_STORAGE_KEY : CARD_ORDER_STORAGE_KEY;

  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [router, refreshSeconds]);

  const breadcrumbKey = breadcrumb.map((b) => b.id).join("/");
  useEffect(() => {
    setKanbanFocusId(null);
    setEditing(false);
  }, [boardLayer, breadcrumbKey]);

  useEffect(() => {
    const columnIds = columns.map((c) => c.teamId);
    const stored = readStoredSavedOrder(orderStorageKey);
    const merged = mergeOrderWithColumns(stored.length > 0 ? stored : columnIds, columnIds);
    setSavedOrderIds(merged);
    setDraftOrderIds((prev) => {
      if (!editing || prev.length === 0) return merged;
      return mergeOrderWithColumns(prev, columnIds);
    });
    setOrderReady(true);
  }, [columns, editing, orderStorageKey]);

  const activeOrderIds = editing ? draftOrderIds : savedOrderIds;

  const orderedColumns = useMemo(() => {
    if (!orderReady) return columns;
    return applyCardOrder(columns, activeOrderIds);
  }, [columns, activeOrderIds, orderReady]);

  const focusedColumn = useMemo(
    () => (kanbanFocusId ? orderedColumns.find((c) => c.teamId === kanbanFocusId) ?? null : null),
    [kanbanFocusId, orderedColumns],
  );

  const hasUnsavedDraft = editing && !sameOrder(draftOrderIds, savedOrderIds);

  const startEditing = () => {
    setDraftOrderIds(savedOrderIds);
    setEditing(true);
    setDraggingId(null);
    setDropTargetId(null);
    setKanbanFocusId(null);
  };

  const saveOrder = () => {
    const next = mergeOrderWithColumns(
      draftOrderIds,
      columns.map((c) => c.teamId),
    );
    setSavedOrderIds(next);
    setDraftOrderIds(next);
    writeStoredSavedOrder(orderStorageKey, next);
    setEditing(false);
    setDraggingId(null);
    setDropTargetId(null);
  };

  const resetToSavedOrder = () => {
    setDraftOrderIds(savedOrderIds);
    setDraggingId(null);
    setDropTargetId(null);
  };

  const emptyLabel =
    boardLayer === "department" ? "No departments in view" : "No companies in view";

  if (columns.length === 0 && !focusedColumn) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-400">{emptyLabel}</p>
      </div>
    );
  }

  if (focusedColumn) {
    return (
      <CompanyFocusKanban
        col={focusedColumn}
        boardLayer={boardLayer}
        onBack={() => setKanbanFocusId(null)}
        onOpenPriority={(priority, tickets) =>
          setModalState({ companyName: focusedColumn.companyName, priority, tickets })
        }
        modal={
          <PriorityRequestsModal
            open={modalState !== null}
            onOpenChange={(open) => {
              if (!open) setModalState(null);
            }}
            companyName={modalState?.companyName ?? ""}
            priority={modalState?.priority ?? "LOW"}
            tickets={modalState?.tickets ?? []}
          />
        }
      />
    );
  }

  return (
    <>
      <div className="flex min-h-0 w-full flex-col gap-3">
        {boardLayer === "department" && (breadcrumb.length > 0 || overviewHref) ? (
          <nav
            aria-label="Department breadcrumb"
            className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400"
          >
            {overviewHref ? (
              <Link
                href={overviewHref}
                className="font-medium text-orange-700 hover:underline dark:text-orange-400"
              >
                Major departments
              </Link>
            ) : (
              <span className="font-medium">Major departments</span>
            )}
            {breadcrumb.map((crumb, index) => {
              const isLast = index === breadcrumb.length - 1;
              return (
                <span key={crumb.id} className="inline-flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                  {isLast || !canDrillSections ? (
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{crumb.name}</span>
                  ) : (
                    <Link
                      href={sectionHref(crumb.id)}
                      className="font-medium text-orange-700 hover:underline dark:text-orange-400"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
            {editing
              ? "Editing layout — drag cards by the grip, then Save to lock. Reset restores the last saved order."
              : boardLayer === "department"
                ? "Double-click a major department to open its sub-departments. Click a priority row for the request list."
                : "Double-click a company card for a kanban view. Click a priority row for the request list."}{" "}
            Refreshes about every {refreshSeconds}s.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={resetToSavedOrder}
                  disabled={!hasUnsavedDraft}
                  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Reset card order
                </button>
                <button
                  type="button"
                  onClick={saveOrder}
                  className="rounded-md border border-orange-500/40 bg-orange-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-orange-500"
                >
                  Save order
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEditing}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Edit order
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {orderedColumns.map((col) => (
            <CompanyCard
              key={col.teamId}
              col={col}
              reorderEnabled={editing}
              dragging={editing && draggingId === col.teamId}
              dropTarget={editing && dropTargetId === col.teamId && draggingId !== col.teamId}
              onOpenPriority={(priority, tickets) =>
                setModalState({ companyName: col.companyName, priority, tickets })
              }
              onActivate={() => {
                if (editing) return;
                if (boardLayer === "department" && col.canDrillDown && canDrillSections) {
                  drillToSection(col.teamId);
                  return;
                }
                setKanbanFocusId(col.teamId);
              }}
              onDrillDown={
                boardLayer === "department" && col.canDrillDown && canDrillSections
                  ? () => drillToSection(col.teamId)
                  : undefined
              }
              onDragStartCard={() => {
                if (!editing) return;
                setDraggingId(col.teamId);
              }}
              onDragEndCard={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
              onDragOverCard={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggingId && draggingId !== col.teamId) {
                  setDropTargetId(col.teamId);
                }
              }}
              onDragLeaveCard={() => {
                setDropTargetId((prev) => (prev === col.teamId ? null : prev));
              }}
              onDropCard={(e) => {
                if (!editing) return;
                e.preventDefault();
                const fromId =
                  e.dataTransfer.getData(DRAG_MIME) ||
                  e.dataTransfer.getData("text/plain") ||
                  draggingId;
                if (!fromId) return;
                const base =
                  draftOrderIds.length > 0 ? draftOrderIds : columns.map((c) => c.teamId);
                setDraftOrderIds(moveTeamId(base, fromId, col.teamId));
                setDraggingId(null);
                setDropTargetId(null);
              }}
            />
          ))}
        </div>
      </div>

      <PriorityRequestsModal
        open={modalState !== null}
        onOpenChange={(open) => {
          if (!open) setModalState(null);
        }}
        companyName={modalState?.companyName ?? ""}
        priority={modalState?.priority ?? "LOW"}
        tickets={modalState?.tickets ?? []}
      />
    </>
  );
}

function CompanyFocusKanban({
  col,
  boardLayer,
  onBack,
  onOpenPriority,
  modal,
}: {
  col: CompanyBoardColumn;
  boardLayer: "company" | "department";
  onBack: () => void;
  onOpenPriority: (priority: TicketPriority, tickets: CompanyTicketCard[]) => void;
  modal: ReactNode;
}) {
  const router = useRouter();
  const flowActive = useKanbanFlowActiveForView(boardLayer);
  const [buckets, setBuckets] = useState(() => ({ ...col.buckets }));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBuckets({ ...col.buckets });
  }, [col]);

  const allTickets = useMemo(() => {
    return [
      ...buckets.unassigned,
      ...buckets.in_progress,
      ...buckets.for_confirmation,
      ...buckets.closed,
    ];
  }, [buckets]);
  const byPriority = useMemo(() => ticketsByPriority(allTickets), [allTickets]);
  const ticketById = useMemo(() => {
    const map = new Map<string, CompanyTicketCard>();
    for (const t of allTickets) map.set(t.id, t);
    return map;
  }, [allTickets]);

  const moveTicket = useCallback(
    async (ticketId: string, toBucket: CompanyBucketId) => {
      const ticket = ticketById.get(ticketId);
      if (!ticket) return;
      const fromBucket = focusBucketForTicket(ticket);
      if (fromBucket === toBucket) return;

      const nextStatus = statusForFocusBucket(toBucket);
      setBusyId(ticketId);
      setError(null);
      try {
        const res = await fetch(`/api/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", status: nextStatus }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          status?: TicketStatus;
        };
        if (!res.ok) {
          setError(data.error ?? "Move not allowed for this transition.");
          setTimeout(() => setError(null), 5000);
          return;
        }
        const updated: CompanyTicketCard = {
          ...ticket,
          status: (data.status ?? nextStatus) as CompanyTicketCard["status"],
          updatedAt: new Date(),
          ...(toBucket === "unassigned"
            ? { assignedAgentId: null, assignedAgentName: null }
            : {}),
        };
        setBuckets((prev) => {
          const flat = [
            ...prev.unassigned,
            ...prev.in_progress,
            ...prev.for_confirmation,
            ...prev.closed,
          ].map((t) => (t.id === ticketId ? updated : t));
          return rebuildFocusBuckets(flat);
        });
        router.refresh();
      } catch {
        setError("Network error — try again.");
        setTimeout(() => setError(null), 5000);
      } finally {
        setBusyId(null);
      }
    },
    [router, ticketById],
  );

  const onDrop = useCallback(
    (itemId: string, column: CompanyBucketId) => {
      void moveTicket(itemId, column);
    },
    [moveTicket],
  );

  const { registerColumn, getCardPointerProps, ghost, hoverColumn, draggingItemId } =
    usePointerColumnDrag<CompanyBucketId>({
      onDrop,
      disabled: !flowActive,
    });

  return (
    <>
      <PointerDragGhostLayer ghost={ghost} />
      <div className="flex min-h-0 w-full flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Back to cards
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {col.companyName}
              </p>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
                Requests sent to this {boardLayer === "department" ? "department" : "company"} ·{" "}
                {allTickets.length} request{allTickets.length === 1 ? "" : "s"}
                {flowActive ? " · drag enabled" : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_ORDER.filter((p) => (byPriority[p]?.length ?? 0) > 0).map((priority) => (
              <button
                key={priority}
                type="button"
                onClick={() => onOpenPriority(priority, byPriority[priority] ?? [])}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  priorityPillClass(priority),
                )}
              >
                {PRIORITY_LABELS[priority]} {(byPriority[priority] ?? []).length}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        {!flowActive ? (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
            Set <span className="font-medium text-zinc-700 dark:text-zinc-300">Kanban flow</span> to{" "}
            {boardLayer === "company" ? "Company" : "Department"} to drag requests between lanes.
          </p>
        ) : null}

        <div className="flex gap-3 overflow-x-auto pb-2">
          {BUCKET_ORDER.map((bucketId) => {
            const laneTickets = buckets[bucketId];
            return (
              <section
                key={bucketId}
                ref={registerColumn(bucketId)}
                className={cn(
                  "flex w-[min(100%,17.5rem)] shrink-0 flex-col rounded-2xl border bg-zinc-50/70 dark:bg-zinc-950/40",
                  hoverColumn === bucketId
                    ? "border-orange-400 ring-2 ring-orange-400/30 dark:border-orange-500"
                    : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    {BUCKET_LABELS[bucketId]}
                  </h3>
                  <span className="tabular-nums text-[11px] font-semibold text-zinc-500">
                    {laneTickets.length}
                  </span>
                </header>
                <ul className="flex max-h-[min(70vh,36rem)] flex-col gap-2 overflow-y-auto p-2">
                  {laneTickets.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-zinc-300 px-2 py-6 text-center text-[11px] text-zinc-500 dark:border-zinc-700">
                      Empty
                    </li>
                  ) : (
                    laneTickets.map((ticket) => (
                      <li
                        key={ticket.id}
                        className={cn(
                          "rounded-xl border border-zinc-200 bg-white shadow-sm transition dark:border-zinc-700 dark:bg-zinc-900",
                          draggingItemId === ticket.id && "opacity-50",
                          busyId === ticket.id && "pointer-events-none opacity-50",
                        )}
                      >
                        <div className="flex gap-1.5 p-2.5">
                          {flowActive ? (
                            <span
                              {...getCardPointerProps(ticket.id, {
                                getLabel: () =>
                                  `${ticket.ticketNumber} · ${ticket.title.slice(0, 80)}`,
                              })}
                              data-drag-handle
                              className="mt-0.5 flex h-7 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md text-zinc-500 active:cursor-grabbing active:text-orange-600 dark:text-zinc-400 dark:active:text-orange-300"
                              title="Drag to another lane"
                              aria-label={`Drag ${ticket.ticketNumber}`}
                              role="button"
                            >
                              <GripVertical className="size-4" aria-hidden />
                            </span>
                          ) : null}
                          <AgentTicketDeepLink
                            ticketId={ticket.id}
                            className="min-w-0 flex-1 rounded-md text-left hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                                {ticket.ticketNumber}
                              </p>
                              <span
                                className={cn(
                                  "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                                  priorityPillClass(ticket.priority),
                                )}
                              >
                                {PRIORITY_LABELS[ticket.priority]}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                              {ticket.title}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                                  statusPillClass(ticket.status),
                                )}
                              >
                                {formatCompanyBoardStatusLabel(ticket.status)}
                              </span>
                              {ticket.assignedAgentName ? (
                                <span className="truncate text-[10px] text-zinc-500">
                                  {ticket.assignedAgentName}
                                </span>
                              ) : null}
                            </div>
                          </AgentTicketDeepLink>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {modal}
    </>
  );
}

function CompanyLogoMark({
  teamId,
  companyName,
  hasLogo,
}: {
  teamId: string;
  companyName: string;
  hasLogo: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [teamId, hasLogo]);

  const showImage = hasLogo && !failed;

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic auth-backed logo API
        <img
          src={`${companyLogoApiPath(teamId)}?v=${encodeURIComponent(companyName)}`}
          alt=""
          className="h-full w-full object-contain p-1.5"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center text-[11px] font-bold tracking-wide text-orange-800 dark:text-orange-200"
          title={companyName}
          aria-hidden
        >
          {companyInitials(companyName)}
        </span>
      )}
    </div>
  );
}

function CompanyCard({
  col,
  onOpenPriority,
  onActivate,
  onDrillDown,
  reorderEnabled,
  dragging,
  dropTarget,
  onDragStartCard,
  onDragEndCard,
  onDragOverCard,
  onDragLeaveCard,
  onDropCard,
}: {
  col: CompanyBoardColumn;
  onOpenPriority: (priority: TicketPriority, tickets: CompanyTicketCard[]) => void;
  onActivate: () => void;
  onDrillDown?: () => void;
  reorderEnabled: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStartCard: () => void;
  onDragEndCard: () => void;
  onDragOverCard: (e: DragEvent) => void;
  onDragLeaveCard: () => void;
  onDropCard: (e: DragEvent) => void;
}) {
  const tickets = useMemo(() => ticketsForColumn(col), [col]);
  const byPriority = useMemo(() => ticketsByPriority(tickets), [tickets]);
  const activePriorities = PRIORITY_ORDER.filter((p) => (byPriority[p]?.length ?? 0) > 0);
  const hasRequests = tickets.length > 0;
  const logoTeamId = col.logoTeamId ?? (col.entityKind === "company" ? col.teamId : null);

  return (
    <article
      onDragOver={reorderEnabled ? onDragOverCard : undefined}
      onDragLeave={reorderEnabled ? onDragLeaveCard : undefined}
      onDrop={reorderEnabled ? onDropCard : undefined}
      onDoubleClick={(e) => {
        if (reorderEnabled) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest("button, a")) return;
        e.preventDefault();
        onActivate();
      }}
      title={
        reorderEnabled
          ? undefined
          : col.canDrillDown
            ? `Double-click to open sub-departments of ${col.companyName}`
            : `Double-click to view requests sent to ${col.companyName}`
      }
      className={cn(
        "flex min-h-[8.5rem] flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_28px_rgba(0,0,0,0.06)] transition dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]",
        hasRequests
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-dashed border-zinc-300 dark:border-zinc-700",
        dragging && "opacity-50 ring-2 ring-orange-400/50",
        dropTarget && "border-orange-400 ring-2 ring-orange-400/40 dark:border-orange-500",
        !reorderEnabled && "cursor-pointer select-none",
      )}
    >
      <div
        className="flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:gap-3 sm:px-4"
        onDoubleClick={(e) => {
          if (reorderEnabled) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest("button, a")) return;
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }}
      >
        {reorderEnabled ? (
          <button
            type="button"
            draggable
            aria-label={`Drag to reorder ${col.companyName}`}
            title="Drag to rearrange"
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, col.teamId);
              e.dataTransfer.setData("text/plain", col.teamId);
              e.dataTransfer.effectAllowed = "move";
              onDragStartCard();
            }}
            onDragEnd={onDragEndCard}
            className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <CompanyLogoMark
          teamId={logoTeamId ?? col.teamId}
          companyName={col.companyName}
          hasLogo={Boolean(col.hasLogo && logoTeamId)}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100" title={col.companyName}>
            {col.companyName}
          </p>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500">
            {tickets.length} request{tickets.length === 1 ? "" : "s"}
            {col.canDrillDown ? " · has sub-departments" : ""}
          </p>
        </div>
        {onDrillDown && !reorderEnabled ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDrillDown();
            }}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/60"
            title={`Open sub-departments of ${col.companyName}`}
          >
            Subs
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {activePriorities.length === 0 ? (
          <p className="flex flex-1 items-center justify-center py-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
            No requests
          </p>
        ) : (
          activePriorities.map((priority) => {
            const priorityTickets = byPriority[priority] ?? [];
            return (
              <PriorityLevelRow
                key={priority}
                priority={priority}
                count={priorityTickets.length}
                onOpen={() => onOpenPriority(priority, priorityTickets)}
              />
            );
          })
        )}
      </div>
    </article>
  );
}

function PriorityLevelRow({
  priority,
  count,
  onOpen,
}: {
  priority: TicketPriority;
  count: number;
  onOpen: () => void;
}) {
  const label = PRIORITY_LABELS[priority];
  const labelClass = priority === "UNSET" ? "normal-case" : "uppercase";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-zinc-50/80 px-3 py-2.5 text-left text-sm transition hover:bg-orange-500/[0.06] dark:bg-zinc-900/40 dark:hover:bg-orange-500/10",
        priority === "URGENT" && "border-rose-300/70 dark:border-rose-500/40",
        priority === "HIGH" && "border-orange-300/70 dark:border-orange-500/40",
        priority === "MEDIUM" && "border-orange-200/80 dark:border-orange-500/25",
        priority === "LOW" && "border-zinc-300 dark:border-zinc-700",
        priority === "UNSET" && "border-amber-300/70 dark:border-amber-500/35",
      )}
    >
      <span
        className={cn(
          "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide",
          labelClass,
          priorityPillClass(priority),
        )}
      >
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="tabular-nums text-xs font-semibold text-zinc-700 dark:text-zinc-300">{count}</span>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
      </span>
    </button>
  );
}

function PriorityRequestsModal({
  open,
  onOpenChange,
  companyName,
  priority,
  tickets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  priority: TicketPriority;
  tickets: CompanyTicketCard[];
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(tickets.length / TICKETS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = tickets.length === 0 ? 0 : (safePage - 1) * TICKETS_PAGE_SIZE + 1;
  const end = Math.min(tickets.length, safePage * TICKETS_PAGE_SIZE);
  const visibleTickets = tickets.slice(start === 0 ? 0 : start - 1, end);

  const label = PRIORITY_LABELS[priority];
  const labelClass = priority === "UNSET" ? "normal-case" : "uppercase";

  useEffect(() => {
    if (open) setPage(1);
  }, [open, priority, companyName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90dvh,40rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden border-zinc-200 bg-white p-0 dark:border-zinc-700 dark:bg-[#111]"
        aria-describedby="priority-requests-description"
      >
        <DialogHeader className="space-y-2 border-b border-zinc-200 px-5 py-4 text-left dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {companyName}
            </DialogTitle>
            <span
              className={cn(
                "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide",
                labelClass,
                priorityPillClass(priority),
              )}
            >
              {label}
            </span>
          </div>
          <DialogDescription id="priority-requests-description" className="text-left text-sm text-zinc-600 dark:text-zinc-400">
            {tickets.length} request{tickets.length === 1 ? "" : "s"} at this priority level. Click a request to open
            its summary.
          </DialogDescription>
        </DialogHeader>

        <ul className="min-h-0 flex-1 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {visibleTickets.map((t) => (
            <li key={t.id}>
              <AgentTicketDeepLink
                ticketId={t.id}
                className="flex w-full flex-col gap-1 px-5 py-3 text-left transition hover:bg-orange-500/[0.05] dark:hover:bg-orange-500/10"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                    {t.ticketNumber}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      statusPillClass(t.status),
                    )}
                  >
                    {formatCompanyBoardStatusLabel(t.status)}
                  </span>
                </div>
                <span className="line-clamp-2 text-sm text-zinc-800 dark:text-zinc-200">{t.title}</span>
                {t.assignedAgentName ? (
                  <span className="text-[11px] text-zinc-500">Assigned: {t.assignedAgentName}</span>
                ) : (
                  <span className="text-[11px] text-zinc-500">Unassigned</span>
                )}
              </AgentTicketDeepLink>
            </li>
          ))}
        </ul>

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <p className="text-[11px] text-zinc-500">
              {start}-{end} of {tickets.length}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-600"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-600"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
