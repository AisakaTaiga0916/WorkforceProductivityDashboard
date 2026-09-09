"use client";

import type { ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isUnsegmentedSegmentId,
  type SubKpiItem,
  type SubKpiSegment,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
} from "@/lib/kpi-subkpis";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import { DatePickerField } from "@/components/ui/DatePickerField";

export type SubtaskKanbanCard = {
  id: string;
  title: string;
  description?: string | null;
  done?: boolean;
  projectStatus?: SubKpiItem["projectStatus"];
  priority?: string | null;
  dueLabel?: string | null;
  segmentId: string;
};

export type SubtaskKanbanBoardModel = {
  id: string;
  label: string;
  dueDate?: string | null;
  items: SubtaskKanbanCard[];
};

/** Display label for the reserved unassigned pool column. */
export const UNASSIGNED_COLUMN_LABEL = "Unassigned";

/**
 * Named segments first, Unassigned last (rendered below segments in the UI).
 * Drop target key is the segment id (or {@link UNSEGMENTED_SEGMENT_ID}).
 */
export function segmentsToKanbanBoards(segments: SubKpiSegment[]): SubtaskKanbanBoardModel[] {
  const named = segments.filter((seg) => !isUnsegmentedSegmentId(seg.id));
  const general =
    segments.find((seg) => isUnsegmentedSegmentId(seg.id)) ??
    ({ id: UNSEGMENTED_SEGMENT_ID, label: UNSEGMENTED_SEGMENT_LABEL, items: [] } as SubKpiSegment);

  const toCard = (item: SubKpiItem, segmentId: string): SubtaskKanbanCard => ({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    done: item.done,
    projectStatus: item.projectStatus,
    priority: item.projectPriority ?? null,
    dueLabel: item.dueDate ?? null,
    segmentId,
  });

  return [
    ...named.map((seg) => ({
      id: seg.id,
      // Keep the raw label (not trimmed) so the controlled rename input accepts
      // spaces while typing — trimming here eats each space before the next
      // keystroke (e.g. "QA Testing" becomes "QATesting").
      label: seg.label,
      dueDate: seg.dueDate ?? null,
      items: seg.items.map((item) => toCard(item, seg.id)),
    })),
    {
      id: general.id,
      label: UNASSIGNED_COLUMN_LABEL,
      items: general.items.map((item) => toCard(item, general.id)),
    },
  ];
}

type SubTasksKanbanViewProps = {
  boards: SubtaskKanbanBoardModel[];
  canManage: boolean;
  busy?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  /** Move card into a segment column (or Unassigned). */
  onDropCard: (itemId: string, targetSegmentId: string) => void;
  renderCardActions?: (card: SubtaskKanbanCard) => ReactNode;
  onEditSegmentLabel?: (segmentId: string, label: string) => void;
  /** When set, named columns show a phase/segment target date field. */
  onEditSegmentDueDate?: (segmentId: string, dueDate: string) => void;
  showPhaseDueDate?: boolean;
  onRemoveSegment?: (segmentId: string) => void;
};

export function SubTasksKanbanView({
  boards,
  canManage,
  busy = false,
  selectedIds,
  onToggleSelected,
  onDropCard,
  renderCardActions,
  onEditSegmentLabel,
  onEditSegmentDueDate,
  showPhaseDueDate = false,
  onRemoveSegment,
}: SubTasksKanbanViewProps) {
  const drag = usePointerColumnDrag<string>({
    disabled: !canManage || busy,
    activationDistance: 10,
    onDrop: (itemId, segmentId) => {
      onDropCard(itemId, segmentId);
    },
  });

  const segmentBoards = boards.filter((board) => !isUnsegmentedSegmentId(board.id));
  const unassignedBoard = boards.find((board) => isUnsegmentedSegmentId(board.id)) ?? null;

  function renderColumn(board: SubtaskKanbanBoardModel, opts: { fullWidth?: boolean } = {}) {
    const isUnassigned = isUnsegmentedSegmentId(board.id);
    const hovering = drag.hoverColumn === board.id;
    return (
      <section
        key={board.id}
        ref={drag.registerColumn(board.id)}
        className={cn(
          "flex flex-col rounded-xl border p-2.5",
          opts.fullWidth ? "w-full" : "w-[min(100%,16.5rem)] shrink-0",
          isUnassigned
            ? "border-dashed border-orange-400/55 bg-orange-500/[0.05] dark:border-orange-500/40 dark:bg-orange-500/[0.08]"
            : "border-zinc-200/90 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-950/50",
          hovering && "ring-2 ring-orange-500/40",
        )}
      >
        <div className="mb-2 flex items-start justify-between gap-1.5 px-0.5">
          <div className="min-w-0 flex-1">
            {canManage && onEditSegmentLabel && !isUnassigned ? (
              <input
                value={board.label}
                onChange={(e) => onEditSegmentLabel(board.id, e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                aria-label={showPhaseDueDate ? "Phase name" : "Segment name"}
              />
            ) : (
<h3
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-[0.12em]",
                      isUnassigned
                        ? "text-orange-800 dark:text-orange-200"
                        : "text-orange-700 dark:text-orange-400",
                    )}
                  >
                    {isUnassigned
                      ? UNASSIGNED_COLUMN_LABEL
                      : board.label.trim() || "Untitled segment"}
                <span className="ml-1 font-semibold normal-case tracking-normal text-zinc-500">
                  ({board.items.length})
                </span>
              </h3>
            )}
            {isUnassigned ? (
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                Waiting list — drag into a {showPhaseDueDate ? "phase" : "segment"} column to assign.
              </p>
            ) : null}
            {showPhaseDueDate && canManage && onEditSegmentDueDate && !isUnassigned ? (
              <label className="mt-1.5 block text-[9px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Target date
                <DatePickerField
                  value={board.dueDate ?? ""}
                  onChange={(e) => onEditSegmentDueDate(board.id, e.target.value)}
                  wrapperClassName="mt-0.5"
                  shellClassName="h-8"
                  aria-label={`${board.label || "Phase"} target date`}
                />
              </label>
            ) : showPhaseDueDate && !isUnassigned && board.dueDate ? (
              <p className="mt-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
                Target {board.dueDate}
              </p>
            ) : null}
          </div>
          {canManage && onRemoveSegment && !isUnassigned ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemoveSegment(board.id)}
              className="shrink-0 rounded-full border border-rose-400/60 px-2 py-0.5 text-[9px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300"
            >
              Remove
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            "min-h-[8rem] flex-1",
            // Unassigned: wrap cards in a horizontal flow so the bottom pool reads as a list strip.
            isUnassigned && opts.fullWidth
              ? "flex flex-wrap content-start gap-1.5"
              : "space-y-1.5",
          )}
        >
          {board.items.length === 0 ? (
            <p
              className={cn(
                "rounded-lg border border-dashed border-zinc-300/80 px-2 py-6 text-center text-[10px] text-zinc-400 dark:border-zinc-700",
                isUnassigned && opts.fullWidth && "w-full",
              )}
            >
              Drop here
            </p>
          ) : (
            board.items.map((card) => (
              <div
                key={card.id}
                {...(canManage
                  ? drag.getCardPointerProps(card.id, { getLabel: () => card.title })
                  : {})}
                className={cn(
                  "rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-950",
                  canManage && "cursor-grab touch-none active:cursor-grabbing",
                  drag.draggingItemId === card.id && "opacity-50 ring-1 ring-orange-400/50",
                  card.done && "border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-800/40",
                  isUnassigned && opts.fullWidth && "w-[min(100%,16.5rem)]",
                )}
              >
                <div className="flex items-start gap-1.5">
                  {canManage && selectedIds && onToggleSelected ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(card.id)}
                      onChange={() => onToggleSelected(card.id)}
                      className="mt-0.5 size-3.5 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                      aria-label={`Select ${card.title}`}
                    />
                  ) : null}
                  {canManage ? (
                    <GripVertical className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-xs font-semibold text-zinc-900 dark:text-zinc-100",
                        card.done && "line-through opacity-70",
                      )}
                    >
                      {card.title}
                    </p>
                    {card.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {card.description}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {card.priority ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-200">
                          {card.priority}
                        </span>
                      ) : null}
                      {card.dueLabel && !showPhaseDueDate ? (
                        <span className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">
                          {card.dueLabel}
                        </span>
                      ) : null}
                    </div>
                    {renderCardActions ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">{renderCardActions(card)}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Named segments stay in a horizontal Trello row */}
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {segmentBoards.map((board) => renderColumn(board))}
        </div>
        {/* Unassigned waiting list sits full-width under the segment columns */}
        {unassignedBoard ? renderColumn(unassignedBoard, { fullWidth: true }) : null}
      </div>
      <PointerDragGhostLayer ghost={drag.ghost} />
    </>
  );
}
