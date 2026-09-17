"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, GripVertical, Pencil, Trash2 } from "lucide-react";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import { AssigneeColorHighlight } from "@/components/ticket/AssigneeColorHighlight";
import { AssigneeInitialsBadge } from "@/components/ticket/AssigneeInitialsBadge";
import { ElapsedFromIso } from "@/components/ElapsedFromIso";
import type { TicketStatus } from "@prisma/client/primary";
import { cn } from "@/lib/cn";
import {
  resolveTicketBoardColumnId,
  targetStatusForBoardColumn,
  type RequestBoardColumnDto,
} from "@/lib/request-board-columns-shared";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { requestTypeAcronym, requestTypeLabel } from "@/lib/request-types";
import { extractPaymentBoardPreview } from "@/lib/request-for-payment";
import { parseItemRequisitionDescription } from "@/lib/item-requisition";
import { extractFundTransferPreview } from "@/lib/fund-transfer-request";
import { extractJobOrderPreview } from "@/lib/job-order";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import { isBoardLaneOverdue } from "@/lib/sla-shared";
import { useRequestBoardEditMode } from "./request-board-edit-mode";

export type KanbanTicket = {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  priority: string;
  status: TicketStatus;
  requestBoardColumnId?: string | null;
  /** When this card entered its current Request Board lane. */
  boardLaneEnteredAt?: string | null;
  /** Intake request type id (ISSUE_CONCERN_TICKET, REQUEST_FOR_PAYMENT, …). */
  requestType?: string | null;
  /** Latest audit-trail timestamp (Job Order overdue clock). */
  lastActivityAt?: string | null;
  /** When the ticket entered FOR_CONFIRMATION (RFP / FTR / R.S. / A.C.A. overdue clock). */
  forConfirmationAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
  /** e.g. APPROVED BY IS MISSING for Request for Payment. */
  proceduralStatusLabel?: string | null;
  updatedAt: string;
  agentName: string | null;
  assigneeColorKey?: string | null;
  assigneeProfileImage?: string | null;
  assigneeProfileImageZoom?: number | null;
  assigneeProfileImagePosX?: number | null;
  assigneeProfileImagePosY?: number | null;
};

function priorityClass(priority: string) {
  if (priority === "UNSET")
    return "bg-amber-500/15 text-amber-950 dark:bg-amber-500/15 dark:text-amber-200";
  if (priority === "URGENT" || priority === "HIGH")
    return "bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200";
  if (priority === "MEDIUM")
    return "bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200";
  return "bg-zinc-200 text-zinc-800 dark:bg-zinc-600/50 dark:text-zinc-200";
}

function priorityBadgeLabel(priority: string) {
  if (priority === "UNSET") return "Set level";
  return priority;
}

function statusBadgeClass(status: TicketStatus) {
  if (status === "OPEN") {
    return "bg-sky-500/15 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200";
  }
  if (status === "IN_PROGRESS") {
    return "bg-indigo-500/15 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-200";
  }
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED") {
    return "bg-emerald-500/15 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200";
  }
  if (status === "ESCALATED") {
    return "bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200";
  }
  if (status === "PENDING_INFO") {
    return "bg-amber-500/15 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200";
  }
  return "bg-zinc-200 text-zinc-800 dark:bg-zinc-600/50 dark:text-zinc-200";
}

function statusBadgeLabel(status: TicketStatus) {
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED") return "FOR CONFIRMATION";
  return formatTicketStatusLabel(status).toUpperCase();
}

function boardCardStatusBadge(column: RequestBoardColumnDto, status: TicketStatus) {
  const custom =
    column.mappingLabel?.trim() ||
    // Renamed boards historically only updated `name`; treat a non-default title as the map.
    (column.name.trim() &&
    column.name.trim().toLowerCase() !== formatTicketStatusLabel(column.mappedStatus).toLowerCase()
      ? column.name.trim()
      : "");
  if (custom) {
    return {
      label: custom.toUpperCase(),
      className:
        "bg-violet-500/15 text-violet-950 dark:bg-violet-500/20 dark:text-violet-100",
    };
  }
  return {
    label: statusBadgeLabel(status),
    className: statusBadgeClass(status),
  };
}

function kanbanCardPreview(ticket: KanbanTicket): string {
  if (ticket.requestType === "REQUEST_FOR_PAYMENT") {
    const preview = extractPaymentBoardPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "ITEM_REQUISITION_SLIP") {
    const purpose = parseItemRequisitionDescription(ticket.description)?.purposeOfRequest?.trim();
    if (purpose) return purpose.slice(0, 120);
  }
  if (ticket.requestType === "FUND_TRANSFER_REQUEST") {
    const preview = extractFundTransferPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "JOB_ORDER") {
    const preview = extractJobOrderPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
    const nature = ticket.description.match(/^Nature of Request:\s*(.*)$/im)?.[1]?.trim();
    if (nature) return nature.slice(0, 120);
  }
  return (ticket.description || ticket.title).trim();
}

export function AgentKanban({
  tickets: initialTickets,
  columns: initialColumns,
  canManageColumns: canManageColumnsProp = false,
  columnTotals,
}: {
  tickets: KanbanTicket[];
  columns: RequestBoardColumnDto[];
  canManageColumns?: boolean;
  columnTotals?: Partial<Record<string, number>>;
}) {
  const router = useRouter();
  const boardEditMode = useRequestBoardEditMode();
  /** Drag / rename / delete only while the header “Edit boards” mode is on. */
  const canManageColumns =
    boardEditMode != null
      ? boardEditMode.canManage && boardEditMode.editing
      : canManageColumnsProp;
  const [tickets, setTickets] = useState(initialTickets);
  const [columns, setColumns] = useState(initialColumns);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [columnBusyId, setColumnBusyId] = useState<string | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [columnDropTargetId, setColumnDropTargetId] = useState<string | null>(null);
  const columnsRef = useRef(columns);
  const columnsBeforeDragRef = useRef<RequestBoardColumnDto[] | null>(null);
  const columnElsRef = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    queueMicrotask(() => setTickets(initialTickets));
  }, [initialTickets]);

  useEffect(() => {
    queueMicrotask(() => setColumns(initialColumns));
  }, [initialColumns]);

  useEffect(() => {
    if (canManageColumns) return;
    setEditingColumnId(null);
    setEditColumnName("");
    setDraggingColumnId(null);
    setColumnDropTargetId(null);
  }, [canManageColumns]);

  function setColumnEl(id: string, el: HTMLElement | null) {
    if (el) columnElsRef.current.set(id, el);
    else columnElsRef.current.delete(id);
  }

  function hitTestColumnId(clientX: number, clientY: number): string | null {
    let best: { id: string; area: number } | null = null;
    for (const [id, el] of columnElsRef.current) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 4) continue;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        if (!best || area < best.area) best = { id, area };
      }
    }
    return best?.id ?? null;
  }

  const ticketColumnId = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets) {
      const colId = resolveTicketBoardColumnId(columns, t);
      if (colId) map.set(t.id, colId);
    }
    return map;
  }, [tickets, columns]);

  async function moveTicket(ticket: KanbanTicket, toColumnId: string) {
    const column = columns.find((c) => c.id === toColumnId);
    if (!column) return;
    const fromColumnId = ticketColumnId.get(ticket.id);
    if (fromColumnId === toColumnId) return;

    if (!column.allowDrop) {
      setError("This board is for newly opened items only. Move work forward into another board.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    const nextStatus = targetStatusForBoardColumn(column, ticket.status);
    if (
      column.mappedStatus === "IN_PROGRESS" &&
      nextStatus === "IN_PROGRESS" &&
      ticket.priority === "UNSET"
    ) {
      setError("Set a priority level on the request before moving it to In progress.");
      setTimeout(() => setError(null), 6000);
      return;
    }

    setBusyId(ticket.id);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          status: nextStatus,
          boardColumnId: column.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: TicketStatus;
        requestBoardColumnId?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? "Move not allowed for this transition.");
        setTimeout(() => setError(null), 5000);
        return;
      }
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id
            ? {
                ...t,
                status: (data.status ?? nextStatus) as TicketStatus,
                requestBoardColumnId: data.requestBoardColumnId ?? column.id,
                boardLaneEnteredAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      router.refresh();
    } catch {
      setError("Network error — try again.");
      setTimeout(() => setError(null), 5000);
    } finally {
      setBusyId(null);
    }
  }

  async function saveColumnRename(columnId: string) {
    const name = editColumnName.trim();
    if (!name) {
      setError("Mapping name cannot be empty.");
      setTimeout(() => setError(null), 4000);
      return;
    }
    setColumnBusyId(columnId);
    setError(null);
    try {
      const res = await fetch(`/api/request-board/columns/${columnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // Board name is the mapping — card status badges read mappingLabel.
          mappingLabel: name,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        column?: RequestBoardColumnDto;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not rename board.");
        setTimeout(() => setError(null), 5000);
        return;
      }
      if (data.column) {
        setColumns((prev) => prev.map((c) => (c.id === columnId ? data.column! : c)));
      }
      setEditingColumnId(null);
      router.refresh();
    } finally {
      setColumnBusyId(null);
    }
  }

  function reorderColumnLocal(fromId: string, toId: string) {
    if (fromId === toId) return;
    setColumns((prev) => {
      const from = prev.findIndex((c) => c.id === fromId);
      const to = prev.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(to, 0, moved);
      columnsRef.current = next;
      return next;
    });
  }

  function onColumnHeaderPointerDown(colId: string, e: ReactPointerEvent<HTMLElement>) {
    if (!canManageColumns || editingColumnId === colId || columnBusyId === "reorder") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Grip is a button; allow it. Ignore rename/delete and other controls.
    const target = e.target as HTMLElement;
    if (target.closest("button:not([data-column-drag-handle]), input, a, select, textarea, label")) {
      return;
    }

    const handle = e.currentTarget;
    e.preventDefault();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let activated = false;
    let lastTargetId: string | null = null;
    columnsBeforeDragRef.current = columnsRef.current;

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* window listeners still track */
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!activated) {
        if (dx * dx + dy * dy < 36) return;
        activated = true;
        setDraggingColumnId(colId);
        document.body.style.userSelect = "none";
        try {
          document.body.style.setProperty("touch-action", "none");
        } catch {
          document.body.style.touchAction = "none";
        }
      }
      const overId = hitTestColumnId(ev.clientX, ev.clientY);
      if (overId && overId !== colId) {
        setColumnDropTargetId(overId);
        if (overId !== lastTargetId) {
          lastTargetId = overId;
          reorderColumnLocal(colId, overId);
        }
      } else {
        setColumnDropTargetId(null);
      }
      if (activated) ev.preventDefault();
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      try {
        document.body.style.removeProperty("touch-action");
      } catch {
        document.body.style.touchAction = "";
      }
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      const before = columnsBeforeDragRef.current;
      const after = columnsRef.current;
      const changed =
        activated &&
        before != null &&
        before.map((c) => c.id).join("\0") !== after.map((c) => c.id).join("\0");
      if (changed) {
        void persistColumnOrder(after);
      } else if (before) {
        setColumns(before);
        columnsRef.current = before;
      }
      columnsBeforeDragRef.current = null;
      setDraggingColumnId(null);
      setColumnDropTargetId(null);
      if (activated) ev.preventDefault();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function persistColumnOrder(next: RequestBoardColumnDto[]) {
    setColumns(next);
    columnsRef.current = next;
    setColumnBusyId("reorder");
    setError(null);
    try {
      const res = await fetch("/api/request-board/columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        columns?: RequestBoardColumnDto[];
      };
      if (!res.ok) {
        setError(data.error ?? "Could not reorder boards.");
        setTimeout(() => setError(null), 5000);
        if (columnsBeforeDragRef.current) {
          setColumns(columnsBeforeDragRef.current);
          columnsRef.current = columnsBeforeDragRef.current;
        }
        router.refresh();
        return;
      }
      if (Array.isArray(data.columns)) {
        setColumns(data.columns);
        columnsRef.current = data.columns;
      }
      router.refresh();
    } finally {
      setColumnBusyId(null);
      columnsBeforeDragRef.current = null;
    }
  }

  async function removeColumn(col: RequestBoardColumnDto) {
    if (col.isDefault) return;
    if (
      !window.confirm(
        `Remove board “${col.name}”? This is blocked if any requests are still in this board.`,
      )
    ) {
      return;
    }
    setColumnBusyId(col.id);
    setError(null);
    try {
      const res = await fetch(`/api/request-board/columns/${col.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        columns?: RequestBoardColumnDto[];
      };
      if (!res.ok) {
        setError(data.error ?? "Could not remove board.");
        setTimeout(() => setError(null), 6000);
        return;
      }
      if (Array.isArray(data.columns)) setColumns(data.columns);
      router.refresh();
    } finally {
      setColumnBusyId(null);
    }
  }

  const { registerColumn, getCardPointerProps, ghost, hoverColumn, draggingItemId } =
    usePointerColumnDrag<string>({
      onDrop: (itemId, columnId) => {
        const t = tickets.find((x) => x.id === itemId);
        if (t) void moveTicket(t, columnId);
      },
      isColumnDropDisabled: (c) => {
        const col = columns.find((x) => x.id === c);
        return !col?.allowDrop;
      },
      activationDistance: 7,
      disabled: busyId != null || draggingColumnId != null || columnBusyId === "reorder",
    });

  function quickMoveTargets(ticket: KanbanTicket) {
    const currentColumnId = ticketColumnId.get(ticket.id);
    return columns.filter((target) => target.id !== currentColumnId && target.allowDrop);
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeLane, setActiveLane] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const syncActive = () => {
      const children = Array.from(el.querySelectorAll<HTMLElement>("[data-lane-index]"));
      if (children.length === 0) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      children.forEach((child, i) => {
        const center = child.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(center - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActiveLane(best);
    };

    syncActive();
    el.addEventListener("scroll", syncActive, { passive: true });
    window.addEventListener("resize", syncActive);
    return () => {
      el.removeEventListener("scroll", syncActive);
      window.removeEventListener("resize", syncActive);
    };
  }, [columns.length]);

  function scrollToLane(index: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(columns.length - 1, index));
    const lane = el.querySelector<HTMLElement>(`[data-lane-index="${clamped}"]`);
    if (lane) {
      lane.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      setActiveLane(clamped);
      return;
    }
    const laneWidth = el.clientWidth * 0.86;
    el.scrollTo({ left: clamped * (laneWidth + 10), behavior: "smooth" });
    setActiveLane(clamped);
  }

  return (
    <div className="space-y-2 md:space-y-3">
      <PointerDragGhostLayer ghost={ghost} />
      {error ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => scrollToLane(activeLane - 1)}
          disabled={activeLane <= 0}
          className="inline-flex size-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 disabled:opacity-35 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          aria-label="Previous lane"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1.5">
          {columns.map((col, index) => (
            <button
              key={col.id}
              type="button"
              onClick={() => scrollToLane(index)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                index === activeLane ? "w-6 bg-orange-500" : "w-1.5 bg-zinc-300 dark:bg-zinc-700",
              )}
              aria-label={`Go to ${col.name}`}
              aria-current={index === activeLane ? "true" : undefined}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => scrollToLane(activeLane + 1)}
          disabled={activeLane >= columns.length - 1}
          className="inline-flex size-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 disabled:opacity-35 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          aria-label="Next lane"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <LayoutGroup id="request-board-columns">
      <div
        ref={scrollerRef}
        data-kanban-scroller
        className="-mx-2 flex snap-x snap-proximity gap-2.5 overflow-x-auto overscroll-x-contain px-2 pb-1 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:snap-none md:gap-4 md:overflow-visible md:px-0 md:pb-0 md:scroll-auto"
        style={{
          WebkitOverflowScrolling: "touch",
          gridTemplateColumns:
            columns.length <= 3
              ? `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`
              : `repeat(auto-fit, minmax(260px, 1fr))`,
        }}
      >
        {columns.map((col, index) => {
          const colTickets = tickets.filter((t) => ticketColumnId.get(t.id) === col.id);
          const dropEnabled = col.allowDrop;
          const highlightDrop = dropEnabled && hoverColumn === col.id && !draggingColumnId;
          const total = columnTotals?.[col.id];
          const isColumnDragging = draggingColumnId === col.id;
          const isColumnDropTarget =
            Boolean(draggingColumnId) &&
            columnDropTargetId === col.id &&
            draggingColumnId !== col.id;

          return (
            <motion.div
              key={col.id}
              layout
              layoutId={`request-board-column-${col.id}`}
              data-lane-index={index}
              data-column-id={col.id}
              ref={(el) => {
                setColumnEl(col.id, el);
                registerColumn(col.id)(el);
              }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.72 }}
              animate={{
                scale: isColumnDragging ? 1.03 : 1,
                opacity: isColumnDragging ? 0.78 : 1,
                y: isColumnDragging ? -4 : 0,
              }}
              className={cn(
                "flex w-[min(86vw,22rem)] shrink-0 snap-center flex-col rounded-xl border border-zinc-200 bg-zinc-50 sm:w-[360px] md:w-auto md:min-h-[280px] md:min-w-0 md:snap-align-none dark:border-zinc-800 dark:bg-zinc-950/40",
                highlightDrop &&
                  "ring-2 ring-orange-500/70 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950",
                isColumnDragging &&
                  "z-20 shadow-[0_18px_40px_rgba(0,0,0,0.18)] ring-2 ring-orange-400/80 dark:shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
                isColumnDropTarget &&
                  "ring-2 ring-sky-500/70 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950",
              )}
            >
              <div
                className={cn(
                  "shrink-0 border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-800 md:px-3",
                  isColumnDragging && "bg-orange-500/10 dark:bg-orange-500/15",
                )}
              >
                <div className="flex items-start gap-1.5">
                  {canManageColumns && editingColumnId !== col.id ? (
                    <button
                      type="button"
                      data-column-drag-handle
                      onPointerDown={(e) => onColumnHeaderPointerDown(col.id, e)}
                      className={cn(
                        "mt-0.5 inline-flex size-8 shrink-0 touch-none select-none items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 active:cursor-grabbing dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-orange-500/60 dark:hover:bg-orange-950/40 dark:hover:text-orange-200",
                        isColumnDragging &&
                          "cursor-grabbing border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500/60 dark:bg-orange-950/50 dark:text-orange-200",
                        !isColumnDragging && "cursor-grab",
                      )}
                      title="Drag to reorder board"
                      aria-label={`Drag to reorder ${col.name}`}
                    >
                      <GripVertical className="size-4" aria-hidden />
                    </button>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    {canManageColumns && editingColumnId === col.id ? (
                      <form
                        className="flex flex-wrap items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveColumnRename(col.id);
                        }}
                      >
                        <input
                          value={editColumnName}
                          onChange={(e) => setEditColumnName(e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                          maxLength={80}
                          autoFocus
                          disabled={columnBusyId === col.id}
                        />
                        <button
                          type="submit"
                          disabled={columnBusyId === col.id}
                          className="rounded-md bg-orange-600 px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingColumnId(null)}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <h3 className="min-w-0 truncate text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-zinc-200">
                          {col.name}
                        </h3>
                        {canManageColumns ? (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              disabled={columnBusyId === col.id || columnBusyId === "reorder"}
                              onClick={() => {
                                setEditingColumnId(col.id);
                                setEditColumnName(col.name);
                                setError(null);
                              }}
                              className="inline-flex size-7 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-white dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
                              aria-label={`Rename ${col.name}`}
                              title="Rename mapping"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            {!col.isDefault ? (
                              <button
                                type="button"
                                disabled={columnBusyId === col.id || columnBusyId === "reorder"}
                                onClick={() => void removeColumn(col)}
                                className="inline-flex size-7 items-center justify-center rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                aria-label={`Remove ${col.name}`}
                                title="Remove board"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <span className="mt-0.5 shrink-0 rounded-full bg-zinc-300/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100">
                    {total != null && total > colTickets.length
                      ? `${colTickets.length} / ${total}`
                      : colTickets.length}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2 md:max-h-[min(70dvh,42rem)] md:overflow-y-auto md:overscroll-contain">
                {colTickets.map((t) => {
                  const statusBadge = boardCardStatusBadge(col, t.status);
                  const laneOverdue = isBoardLaneOverdue({
                    status: t.status,
                    requestType: t.requestType,
                    boardLaneEnteredAt: t.boardLaneEnteredAt,
                    updatedAt: t.updatedAt,
                    createdAt: t.createdAt,
                    lastActivityAt: t.lastActivityAt,
                    forConfirmationAt: t.forConfirmationAt,
                    resolvedAt: t.resolvedAt,
                  });
                  const laneEnteredIso = t.boardLaneEnteredAt ?? t.updatedAt;
                  return (
                  <AssigneeColorHighlight
                    key={t.id}
                    assigneeColorKey={t.assigneeColorKey}
                    className={cn(
                      "rounded-lg border border-zinc-200 bg-white shadow-sm transition dark:border-zinc-800 dark:bg-[#181716]",
                      draggingItemId === t.id && "opacity-55",
                      busyId === t.id && "pointer-events-none opacity-50",
                      t.status === "ESCALATED" && "ring-1 ring-rose-500/40",
                      laneOverdue && "ring-1 ring-rose-600/50",
                    )}
                  >
                    <div className="flex gap-1.5 p-2.5 sm:p-3 sm:pt-2">
                      <span
                        {...getCardPointerProps(t.id, {
                          getLabel: () => `#${t.ticketNumber} · ${kanbanCardPreview(t).slice(0, 80)}`,
                        })}
                        data-drag-handle
                        className={cn(
                          "mt-0.5 flex min-h-10 w-7 shrink-0 touch-none select-none flex-col items-center justify-center rounded-md text-zinc-600 active:text-orange-700 md:min-h-0 md:w-auto md:cursor-grab md:active:cursor-grabbing dark:text-zinc-400 dark:active:text-orange-300",
                          // Touch-friendly grip chrome only below md; desktop stays icon-only.
                          "border border-zinc-300 bg-zinc-50 active:bg-orange-50 md:border-0 md:bg-transparent md:active:bg-transparent dark:border-zinc-700 dark:bg-zinc-900/70 dark:active:bg-orange-950/30 md:dark:bg-transparent",
                          busyId === t.id && "pointer-events-none",
                        )}
                        title="Hold and drag to another lane (touch or mouse)"
                        aria-label={`Drag ticket ${t.ticketNumber}`}
                        role="button"
                      >
                        <GripVertical className="size-4" />
                        <span className="sr-only">Drag</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <AgentTicketDeepLink
                          ticketId={t.id}
                          className="block min-w-0 cursor-pointer rounded-md text-left hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                        >
                          <div className="flex flex-col gap-1.5 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
                            <span className="min-w-0 font-mono text-[11px] font-semibold text-zinc-800 hover:text-orange-700 dark:text-zinc-300 dark:hover:text-orange-300">
                              #{t.ticketNumber}
                            </span>
                            <div className="flex flex-wrap items-center gap-1 min-[420px]:justify-end">
                              <span
                                className="rounded-full border border-zinc-400 bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-800 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100"
                                title={requestTypeLabel(t.requestType)}
                              >
                                {requestTypeAcronym(t.requestType)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                  priorityClass(t.priority),
                                )}
                              >
                                {priorityBadgeLabel(t.priority)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                  statusBadge.className,
                                )}
                              >
                                {statusBadge.label}
                              </span>
                              {laneOverdue ? (
                                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                  Overdue
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-1 line-clamp-3 break-words text-sm font-semibold leading-snug text-zinc-950 hover:underline sm:line-clamp-2 dark:text-zinc-50">
                            {kanbanCardPreview(t)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            <span title="Time in this column">
                              <ElapsedFromIso iso={laneEnteredIso} className="inline shrink-0" />
                            </span>
                            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                              {t.proceduralStatusLabel ? (
                                <span
                                  className="max-w-full truncate rounded-full border border-amber-600/45 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100"
                                  title={t.proceduralStatusLabel}
                                >
                                  {t.proceduralStatusLabel}
                                </span>
                              ) : null}
                              <AssigneeInitialsBadge
                                agentName={t.agentName}
                                assigneeColorKey={t.assigneeColorKey}
                                profileImage={t.assigneeProfileImage}
                                profileImageZoom={t.assigneeProfileImageZoom}
                                profileImagePosX={t.assigneeProfileImagePosX}
                                profileImagePosY={t.assigneeProfileImagePosY}
                              />
                            </div>
                          </div>
                        </AgentTicketDeepLink>
                        {quickMoveTargets(t).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5 md:hidden">
                            {quickMoveTargets(t).map((target) => (
                              <button
                                key={target.id}
                                type="button"
                                disabled={busyId === t.id}
                                onClick={() => void moveTicket(t, target.id)}
                                className="rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-800 active:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200"
                              >
                                Move to {target.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </AssigneeColorHighlight>
                  );
                })}

                {colTickets.length === 0 && (
                  <div className="flex min-h-[92px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-5 text-center dark:border-zinc-700">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      {dropEnabled ? "+ Drop here" : "Open lane"}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      {dropEnabled
                        ? "Drag a card from another lane"
                        : "New requests land here"}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      </LayoutGroup>
    </div>
  );
}
