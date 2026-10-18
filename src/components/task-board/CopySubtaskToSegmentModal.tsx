"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { isUnsegmentedSegmentId, UNSEGMENTED_SEGMENT_LABEL } from "@/modules/tasks/kpi-subkpis";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";

export type CopySegmentOption = { id: string; label: string };

type CopySubtaskToSegmentModalProps = {
  open: boolean;
  /** Titles of the sub-tasks being copied (for the description). */
  sourceTitles: string[];
  /** Segment id of the first source — used to hide "same segment only" when single-source. */
  sourceSegmentIds: string[];
  segments: CopySegmentOption[];
  busy?: boolean;
  hideDueDate?: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    targetSegmentIds: string[];
    keepDueDate: boolean;
    keepAssignee: boolean;
    keepPriority: boolean;
  }) => void | Promise<void>;
};

export function CopySubtaskToSegmentModal({
  open,
  sourceTitles,
  sourceSegmentIds,
  segments,
  busy = false,
  hideDueDate = false,
  onClose,
  onConfirm,
}: CopySubtaskToSegmentModalProps) {
  const sourceSegSet = useMemo(() => new Set(sourceSegmentIds.filter(Boolean)), [sourceSegmentIds]);
  const availableTargets = useMemo(
    () =>
      // When copying a single source, exclude its current segment from the list.
      // For bulk across multiple segments, show all segments (server skips same-segment copies).
      sourceSegSet.size === 1
        ? segments.filter((seg) => !sourceSegSet.has(seg.id))
        : segments,
    [segments, sourceSegSet],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [keepDueDate, setKeepDueDate] = useState(true);
  const [keepAssignee, setKeepAssignee] = useState(false);
  const [keepPriority, setKeepPriority] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(availableTargets.map((s) => s.id)));
    setKeepDueDate(true);
    setKeepAssignee(false);
    setKeepPriority(true);
  }, [open, availableTargets]);

  if (!open) return null;

  const count = sourceTitles.length;
  const headline =
    count === 1
      ? `Copy “${sourceTitles[0] || "Untitled"}” to another segment`
      : `Copy ${count} sub-tasks to other segments`;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <TaskBoardPopup
      open={open}
      title="Copy to Segment"
      description={headline}
      onClose={busy ? () => undefined : onClose}
      size="md"
    >
      {availableTargets.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            There are no other segments to copy into. Add another segment first, or this checklist is
            not segmented.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Target segments
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
              {availableTargets.map((seg) => (
                <li key={seg.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                    <input
                      type="checkbox"
                      checked={selected.has(seg.id)}
                      disabled={busy}
                      onChange={() => toggle(seg.id)}
                      className="size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {isUnsegmentedSegmentId(seg.id)
                        ? UNSEGMENTED_SEGMENT_LABEL
                        : seg.label || "Untitled segment"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Copy options
            </p>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={keepPriority}
                disabled={busy}
                onChange={(e) => setKeepPriority(e.target.checked)}
                className="size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
              />
              Keep priority
            </label>
            {!hideDueDate ? (
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={keepDueDate}
                  disabled={busy}
                  onChange={(e) => setKeepDueDate(e.target.checked)}
                  className="size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                />
                Keep custom target date
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={keepAssignee}
                disabled={busy}
                onChange={(e) => setKeepAssignee(e.target.checked)}
                className="size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
              />
              Keep assignee
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
              Keep custom target date copies a stored due date when present. Subtasks without a custom
              date keep inheriting the main task target. Uncheck to clear dates (inherit after copy).
              Copies start as Pending. Screenshots, progress, and assistance flags are not copied.
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() =>
                void onConfirm({
                  targetSegmentIds: [...selected],
                  keepDueDate: hideDueDate ? false : keepDueDate,
                  keepAssignee,
                  keepPriority,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500 bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy className="size-3.5" aria-hidden />
              {busy ? "Copying…" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </TaskBoardPopup>
  );
}
