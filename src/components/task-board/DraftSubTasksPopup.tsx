"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  copySubKpiItemsToSegments,
  ensureUnsegmentedSegment,
  isUnsegmentedSegmentId,
  normalizeSubKpis,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
  type SubKpiItem,
} from "@/modules/tasks/kpi-subkpis";
import { CopySubtaskToSegmentModal } from "@/components/task-board/CopySubtaskToSegmentModal";
import {
  segmentsToKanbanBoards,
  SubTasksKanbanView,
} from "@/components/task-board/SubTasksKanbanView";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { DatePickerField } from "@/components/ui/DatePickerField";

const PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const;

type DraftForm = {
  title: string;
  description: string;
  remarks: string;
  dueDate: string;
  useCustomDueDate: boolean;
  /** Advance custom due date with each recurrence cycle (monthly → next month, etc.). */
  dueDateRollsWithCycle: boolean;
  priority: string;
  segmentId: string;
};

const EMPTY: DraftForm = {
  title: "",
  description: "",
  remarks: "",
  dueDate: "",
  useCustomDueDate: false,
  dueDateRollsWithCycle: false,
  priority: "",
  segmentId: "",
};

type DraftSegment = { id: string; label: string; items: SubKpiItem[]; dueDate?: string | null };

type DraftSubTasksPopupProps = {
  open: boolean;
  taskLabel: string;
  items: SubKpiItem[];
  segmented: boolean;
  segments: DraftSegment[];
  canSegment: boolean;
  /** Project mode: offer phase columns instead of generic segments. */
  canMakePhases?: boolean;
  minimumSegmentItems: number;
  hideDueDate?: boolean;
  /** Show “adjust with each cycle” for recurring (non-daily) tasks. */
  allowDueDateRollWithCycle?: boolean;
  /** Main-task target date shown when a subtask inherits. */
  parentDueDate?: string;
  /** Optional Job Order ticket link shown as Check Reference in this form. */
  checkReferenceHref?: string | null;
  onChange: (next: SubKpiItem[]) => void;
  onSegmentedChange: (next: boolean) => void;
  /** Prefer functional updates so adds never drop existing Unassigned cards. */
  onSegmentsChange: (next: DraftSegment[] | ((prev: DraftSegment[]) => DraftSegment[])) => void;
  onClose: () => void;
};

/** Local (pre-save) Sub Tasks manager for the Task Management create form. */
export function DraftSubTasksPopup({
  open,
  taskLabel,
  items,
  segmented,
  segments,
  canSegment,
  canMakePhases = false,
  minimumSegmentItems: _minimumSegmentItems,
  hideDueDate = false,
  allowDueDateRollWithCycle = false,
  parentDueDate = "",
  checkReferenceHref = null,
  onChange,
  onSegmentedChange,
  onSegmentsChange,
  onClose,
}: DraftSubTasksPopupProps) {
  const [addDraft, setAddDraft] = useState<DraftForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [copySourceIds, setCopySourceIds] = useState<string[] | null>(null);

  const allItems = segmented ? segments.flatMap((segment) => segment.items) : items;
  const namedSegments = segments.filter((segment) => !isUnsegmentedSegmentId(segment.id));
  const canCopyToSegment = segmented && namedSegments.length > 0;
  const kanbanBoards = useMemo(
    () => (segmented ? segmentsToKanbanBoards(ensureUnsegmentedSegment(segments)) : []),
    [segmented, segments],
  );

  if (!open) return null;

  const copySources = copySourceIds
    ? allItems.filter((item) => copySourceIds.includes(item.id))
    : [];
  const copySourceSegmentIds = copySources.map(
    (item) =>
      segments.find((segment) => segment.items.some((candidate) => candidate.id === item.id))?.id ??
      "",
  );

  function patchItems(updater: (current: SubKpiItem[]) => SubKpiItem[]) {
    if (!segmented) {
      onChange(updater(items));
      return;
    }
    onSegmentsChange((prev) =>
      ensureUnsegmentedSegment(prev).map((segment) => ({
        ...segment,
        items: updater(segment.items),
      })),
    );
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmCopy(opts: {
    targetSegmentIds: string[];
    keepDueDate: boolean;
    keepAssignee: boolean;
    keepPriority: boolean;
  }) {
    if (!copySourceIds?.length || !segmented) return;
    const result = copySubKpiItemsToSegments(
      { segmented: true, segments: ensureUnsegmentedSegment(segments) },
      {
        sourceIds: copySourceIds,
        targetSegmentIds: opts.targetSegmentIds,
        keepDueDate: opts.keepDueDate,
        keepAssignee: opts.keepAssignee,
        keepPriority: opts.keepPriority,
      },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const normalized = normalizeSubKpis(result.json);
    if (!normalized.segmented) {
      setError("Could not copy sub-tasks.");
      return;
    }
    onSegmentsChange(
      normalized.segments.map((segment) => ({
        id: segment.id,
        label: segment.label,
        items: segment.items,
      })),
    );
    const n = result.copiedCount;
    setSuccess(
      n === 1
        ? "Copied 1 sub-task to the selected segment(s)."
        : `Copied ${n} sub-tasks to the selected segment(s).`,
    );
    setError(null);
    setCopySourceIds(null);
    setSelectedIds(new Set());
  }

  function addItem() {
    const title = addDraft.title.trim();
    if (!title) {
      setError("Sub Task title is required.");
      return;
    }
    if (!hideDueDate && !canMakePhases && addDraft.useCustomDueDate && !addDraft.dueDate) {
      setError("Choose a custom target date, or uncheck the option to inherit the main task date.");
      return;
    }
    const next: SubKpiItem = {
      id: crypto.randomUUID(),
      title,
      projectStatus: "Pending",
      done: false,
      ...(addDraft.description.trim() ? { description: addDraft.description.trim() } : {}),
      ...(addDraft.remarks.trim() ? { remarks: addDraft.remarks.trim() } : {}),
      ...(!hideDueDate && !canMakePhases && addDraft.useCustomDueDate && addDraft.dueDate
        ? {
            dueDate: addDraft.dueDate,
            ...(allowDueDateRollWithCycle && addDraft.dueDateRollsWithCycle
              ? { dueDateRollsWithCycle: true }
              : {}),
          }
        : {}),
      ...(addDraft.priority === "High" || addDraft.priority === "Medium" || addDraft.priority === "Low"
        ? { projectPriority: addDraft.priority }
        : {}),
    };
    if (segmented) {
      // Functional update: always append onto the latest Unassigned list (avoids dropping prior cards).
      onSegmentsChange((prev) => {
        const ensured = ensureUnsegmentedSegment(prev);
        return ensured.map((segment) =>
          isUnsegmentedSegmentId(segment.id)
            ? { ...segment, items: [...segment.items, next] }
            : segment,
        );
      });
    } else {
      onChange([...items, next]);
    }
    setAddDraft(EMPTY);
    setError(null);
  }

  function moveCardOnKanban(itemId: string, targetSegmentId: string) {
    onSegmentsChange((prev) => {
      const ensured = ensureUnsegmentedSegment(prev);
      let moved: SubKpiItem | null = null;
      const stripped = ensured.map((seg) => {
        const hit = seg.items.find((item) => item.id === itemId);
        if (!hit) return seg;
        moved = hit;
        return { ...seg, items: seg.items.filter((item) => item.id !== itemId) };
      });
      if (!moved) return prev;
      const targetId = stripped.some((seg) => seg.id === targetSegmentId)
        ? targetSegmentId
        : UNSEGMENTED_SEGMENT_ID;
      return ensureUnsegmentedSegment(
        stripped.map((seg) =>
          seg.id === targetId ? { ...seg, items: [...seg.items, moved!] } : seg,
        ),
      );
    });
  }

  function startEdit(item: SubKpiItem) {
    setEditingId(item.id);
    setEditDraft({
      title: item.title,
      description: item.description ?? "",
      remarks: item.remarks ?? "",
      dueDate: item.dueDate ?? "",
      useCustomDueDate: Boolean(item.dueDate?.trim()),
      dueDateRollsWithCycle: item.dueDateRollsWithCycle === true && Boolean(item.dueDate?.trim()),
      priority: item.projectPriority ?? "",
      segmentId:
        segments.find((segment) => segment.items.some((candidate) => candidate.id === item.id))?.id ?? "",
    });
    setError(null);
  }

  function saveEdit(id: string) {
    const title = editDraft.title.trim();
    if (!title) {
      setError("Sub Task title is required.");
      return;
    }
    if (!hideDueDate && !canMakePhases && editDraft.useCustomDueDate && !editDraft.dueDate) {
      setError("Choose a custom target date, or uncheck the option to inherit the main task date.");
      return;
    }
    patchItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next: SubKpiItem = { ...item, title };
        const desc = editDraft.description.trim();
        if (desc) next.description = desc;
        else delete (next as { description?: string }).description;
        const remarks = editDraft.remarks.trim();
        if (remarks) next.remarks = remarks;
        else delete (next as { remarks?: string }).remarks;
        if (canMakePhases) {
          delete (next as { dueDate?: string }).dueDate;
        } else if (!hideDueDate) {
          if (editDraft.useCustomDueDate && editDraft.dueDate) {
            next.dueDate = editDraft.dueDate;
            if (allowDueDateRollWithCycle && editDraft.dueDateRollsWithCycle) {
              next.dueDateRollsWithCycle = true;
            } else {
              delete (next as { dueDateRollsWithCycle?: boolean }).dueDateRollsWithCycle;
            }
          } else {
            delete (next as { dueDate?: string }).dueDate;
            delete (next as { dueDateRollsWithCycle?: boolean }).dueDateRollsWithCycle;
          }
        }
        if (
          editDraft.priority === "High" ||
          editDraft.priority === "Medium" ||
          editDraft.priority === "Low"
        ) {
          next.projectPriority = editDraft.priority;
        } else {
          delete (next as { projectPriority?: SubKpiItem["projectPriority"] }).projectPriority;
        }
        return next;
      }),
    );
    setEditingId(null);
    setError(null);
  }

  function removeItem(item: SubKpiItem) {
    if (!window.confirm(`Remove sub-task "${item.title}"?`)) return;
    patchItems((current) => current.filter((x) => x.id !== item.id));
    setSelectedIds((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    if (editingId === item.id) setEditingId(null);
  }

  function addSegment() {
    const nextNumber = namedSegments.length + 1;
    const labelPrefix = canMakePhases ? "Phase" : "Segment";
    const defaultDue = canMakePhases ? parentDueDate.trim() || null : null;
    onSegmentsChange((prev) => {
      const ensured = ensureUnsegmentedSegment(prev);
      const unassignedItems =
        ensured.find((s) => isUnsegmentedSegmentId(s.id))?.items ?? [];
      return ensureUnsegmentedSegment([
        ...ensured.filter((s) => !isUnsegmentedSegmentId(s.id)),
        {
          id: crypto.randomUUID(),
          label: `${labelPrefix} ${nextNumber}`,
          items: [],
          ...(defaultDue ? { dueDate: defaultDue } : {}),
        },
        {
          id: UNSEGMENTED_SEGMENT_ID,
          label: UNSEGMENTED_SEGMENT_LABEL,
          items: [...unassignedItems],
        },
      ]);
    });
  }

  function removeSegment(segment: DraftSegment) {
    if (isUnsegmentedSegmentId(segment.id)) {
      setError("The Unassigned column cannot be removed.");
      return;
    }
    const detail =
      segment.items.length > 0
        ? ` Its ${segment.items.length} sub-task${segment.items.length === 1 ? "" : "s"} will move to Unassigned.`
        : "";
    if (!window.confirm(`Remove segment "${segment.label || "Untitled"}"?${detail}`)) return;
    const movedItems = segment.items;
    onSegmentsChange((prev) => {
      const remaining = ensureUnsegmentedSegment(prev)
        .filter((candidate) => candidate.id !== segment.id)
        .map((seg) =>
          isUnsegmentedSegmentId(seg.id)
            ? { ...seg, items: [...seg.items, ...movedItems] }
            : seg,
        );
      return ensureUnsegmentedSegment(remaining);
    });
  }

  function updateSegmentLabel(segmentId: string, label: string) {
    if (isUnsegmentedSegmentId(segmentId)) return;
    onSegmentsChange((prev) =>
      prev.map((segment) => (segment.id === segmentId ? { ...segment, label } : segment)),
    );
  }

  function updateSegmentDueDate(segmentId: string, dueDate: string) {
    if (isUnsegmentedSegmentId(segmentId)) return;
    onSegmentsChange((prev) =>
      prev.map((segment) =>
        segment.id === segmentId
          ? { ...segment, dueDate: dueDate.trim() || null }
          : segment,
      ),
    );
  }

  function renderItemCard(s: SubKpiItem, options?: { hideSegmentLabel?: boolean }) {
    return (
      <div
        key={s.id}
        className="rounded-lg border border-zinc-200/80 bg-white/60 p-3 dark:border-zinc-700 dark:bg-zinc-950/40"
      >
        {editingId === s.id ? (
          <div className="space-y-2">
            {renderFields(editDraft, (next) => setEditDraft((prev) => ({ ...prev, ...next })), "Edit")}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!editDraft.title.trim()}
                onClick={() => saveEdit(s.id)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {canCopyToSegment ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleSelected(s.id)}
                    className="mt-1 size-3.5 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                    aria-label={`Select ${s.title}`}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</p>
                  {!options?.hideSegmentLabel && segmented ? (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                      {segments.find((segment) =>
                        segment.items.some((candidate) => candidate.id === s.id),
                      )?.label || "Unlabeled segment"}
                    </p>
                  ) : null}
                  {s.description ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                      {s.description}
                    </p>
                  ) : null}
                  {s.remarks ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-500">
                      <span className="font-semibold text-zinc-600 dark:text-zinc-400">Remarks: </span>
                      {s.remarks}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {s.projectPriority ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    {s.projectPriority}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {canMakePhases
                  ? (() => {
                      const phase = segments.find((segment) =>
                        segment.items.some((candidate) => candidate.id === s.id),
                      );
                      return phase?.dueDate?.trim()
                        ? `Phase target ${phase.dueDate.trim()}`
                        : "Uses phase target date";
                    })()
                  : !hideDueDate
                    ? s.dueDate
                      ? `Target ${s.dueDate}${s.dueDateRollsWithCycle ? " · rolls with cycle" : ""}`
                      : parentDueDate.trim()
                        ? `Target ${parentDueDate.trim()} (from main task)`
                        : "Uses main task target date"
                    : "\u00a0"}
              </p>
              <div className="flex items-center gap-1.5">
                {canCopyToSegment ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccess(null);
                      setCopySourceIds([s.id]);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-orange-500/60 px-2.5 py-1 text-[10px] font-semibold text-orange-800 hover:bg-orange-500/10 dark:border-orange-500/40 dark:text-orange-200 dark:hover:bg-orange-950/40"
                  >
                    <Copy className="size-3" aria-hidden />
                    Copy to Segment
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Pencil className="size-3" aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-400/60 px-2.5 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="size-3" aria-hidden />
                  Delete
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderFields(draft: DraftForm, patch: (next: Partial<DraftForm>) => void, idPrefix: string) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500 sm:col-span-2">
          Title
          <input
            type="text"
            value={draft.title}
            placeholder="Sub Task title"
            onChange={(e) => patch({ title: e.target.value })}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500 sm:col-span-2">
          Description
          <textarea
            value={draft.description}
            rows={2}
            placeholder="Optional details"
            onChange={(e) => patch({ description: e.target.value })}
            className="mt-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500 sm:col-span-2">
          Remarks
          <span className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
            Optional
          </span>
          <textarea
            value={draft.remarks}
            rows={2}
            placeholder="Optional remarks or notes"
            onChange={(e) => patch({ remarks: e.target.value })}
            className="mt-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {!hideDueDate && !canMakePhases ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={draft.useCustomDueDate}
                onChange={(e) =>
                  patch({
                    useCustomDueDate: e.target.checked,
                    ...(e.target.checked ? {} : { dueDate: "", dueDateRollsWithCycle: false }),
                  })
                }
                className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
              />
              <span>
                Use custom target date for this subtask
                {!draft.useCustomDueDate ? (
                  <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
                    {parentDueDate.trim()
                      ? `Will use main task target date (${parentDueDate.trim()})`
                      : "Will use main task target date"}
                  </span>
                ) : null}
              </span>
            </label>
            {draft.useCustomDueDate ? (
              <div className="flex flex-col gap-2 sm:max-w-xs">
                <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                  Target date
                  <DatePickerField
                    value={draft.dueDate}
                    onChange={(e) => patch({ dueDate: e.target.value })}
                    wrapperClassName="mt-1"
                    aria-label={`${idPrefix} target date`}
                  />
                </label>
                {allowDueDateRollWithCycle ? (
                  <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold normal-case tracking-normal text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={draft.dueDateRollsWithCycle}
                      onChange={(e) => patch({ dueDateRollsWithCycle: e.target.checked })}
                      className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span>
                      Adjust with each recurring cycle
                      <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
                        e.g. Aug 15 becomes Sep 15 on the next monthly cycle
                      </span>
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : canMakePhases ? (
          <p className="text-[11px] font-medium normal-case tracking-normal text-zinc-500 sm:col-span-2 dark:text-zinc-400">
            Target dates are set on each phase column above — not on individual sub-tasks.
          </p>
        ) : null}
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          Priority
          <select
            value={draft.priority}
            onChange={(e) => patch({ priority: e.target.value })}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">No priority</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <>
    <TaskBoardPopup
      open={open}
      title="Sub Tasks"
      description={`Add and edit sub-tasks for "${taskLabel || "this task"}". Changes apply when you click Apply on the main form.`}
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </button>
          {checkReferenceHref?.trim() ? (
            <a
              href={checkReferenceHref.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center rounded-md border border-orange-500/50 bg-orange-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-orange-500"
            >
              Check Reference
            </a>
          ) : null}
        </div>

        {error ? (
          <p
            className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-800 dark:border-rose-500/40 dark:text-rose-200"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200"
            role="status"
          >
            {success}
          </p>
        ) : null}

        {canCopyToSegment && selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-400/40 bg-orange-500/[0.07] px-3 py-2 dark:border-orange-500/30">
            <p className="text-xs font-semibold text-orange-900 dark:text-orange-100">
              {selectedIds.size} selected
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-full border border-zinc-300 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuccess(null);
                  setCopySourceIds([...selectedIds]);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-orange-500 bg-orange-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-orange-600"
              >
                <Copy className="size-3" aria-hidden />
                Copy to Segment
              </button>
            </div>
          </div>
        ) : null}

        {canSegment || canMakePhases || segmented ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={segmented}
                  onChange={(event) => {
                    onSegmentedChange(event.target.checked);
                    setEditingId(null);
                    setAddDraft(EMPTY);
                    setSelectedIds(new Set());
                    setError(null);
                  }}
                  className="mt-0.5"
                />
                <span>
                  {canMakePhases ? "Make Phases" : "Segment this checklist"}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {canMakePhases
                      ? "Each phase is a column on the Timeline Tracker. New cards start in Unassigned — drag them into a phase."
                      : "Each segment is a column (Trello-style). New cards start in Unassigned — drag them into a segment."}
                  </span>
                </span>
              </label>
              {segmented ? (
                <button
                  type="button"
                  onClick={addSegment}
                  className="inline-flex items-center gap-1 rounded-lg border border-orange-500/50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-500/10 dark:text-orange-300"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {canMakePhases ? "Add phase" : "Add segment"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-500">
            {allItems.length} sub-task{allItems.length === 1 ? "" : "s"}
            {segmented
              ? canMakePhases
                ? " · Drag between Unassigned and phase columns"
                : " · Drag between Unassigned and segment columns"
              : ""}
            {canCopyToSegment ? " · Select multiple to copy" : ""}
          </p>
          {segmented ? (
            <SubTasksKanbanView
              boards={kanbanBoards}
              canManage
              selectedIds={canCopyToSegment ? selectedIds : undefined}
              onToggleSelected={canCopyToSegment ? toggleSelected : undefined}
              onDropCard={moveCardOnKanban}
              showPhaseDueDate={canMakePhases}
              onEditSegmentLabel={(segmentId, label) => updateSegmentLabel(segmentId, label)}
              onEditSegmentDueDate={
                canMakePhases
                  ? (segmentId, dueDate) => updateSegmentDueDate(segmentId, dueDate)
                  : undefined
              }
              onRemoveSegment={(segmentId) => {
                const seg = segments.find((s) => s.id === segmentId);
                if (seg) removeSegment(seg);
              }}
              renderCardActions={(card) => (
                <>
                  {canCopyToSegment ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSuccess(null);
                        setCopySourceIds([card.id]);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-orange-500/60 px-2 py-0.5 text-[9px] font-semibold text-orange-800 hover:bg-orange-500/10 dark:text-orange-200"
                    >
                      <Copy className="size-2.5" aria-hidden />
                      Copy
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const item = allItems.find((x) => x.id === card.id);
                      if (item) startEdit(item);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-[9px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                  >
                    <Pencil className="size-2.5" aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const item = allItems.find((x) => x.id === card.id);
                      if (item) removeItem(item);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-rose-400/60 px-2 py-0.5 text-[9px] font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300"
                  >
                    <Trash2 className="size-2.5" aria-hidden />
                    Delete
                  </button>
                </>
              )}
            />
          ) : allItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              No sub-tasks yet. Add the first one below.
            </p>
          ) : (
            <div className="space-y-2">{allItems.map((s) => renderItemCard(s))}</div>
          )}
          {editingId ? (
            <div className="rounded-lg border border-orange-400/40 bg-orange-500/[0.06] p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
                Edit Sub Task
              </p>
              {renderFields(editDraft, (next) => setEditDraft((prev) => ({ ...prev, ...next })), "Edit")}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editDraft.title.trim()}
                  onClick={() => saveEdit(editingId)}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                >
                  Save changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-dashed border-orange-400/50 bg-orange-500/[0.04] p-3 dark:border-orange-500/35 dark:bg-orange-500/[0.07]">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
            Add Sub Task
          </p>
          <div className="mt-2 space-y-2">
            {segmented ? (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                New sub-tasks land on Unassigned. Drag them onto a{" "}
                {canMakePhases ? "phase" : "segment"} column before creating the task — Unassigned must
                be empty to finalize.
              </p>
            ) : null}
            {renderFields(addDraft, (next) => setAddDraft((prev) => ({ ...prev, ...next })), "New")}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!addDraft.title.trim()}
                onClick={addItem}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Plus className="size-3.5" aria-hidden />
                Add Sub Task
              </button>
            </div>
          </div>
        </div>
      </div>
    </TaskBoardPopup>
      <CopySubtaskToSegmentModal
        open={Boolean(copySourceIds?.length)}
        sourceTitles={copySources.map((s) => s.title)}
        sourceSegmentIds={copySourceSegmentIds.filter(Boolean)}
        segments={segments.map((segment) => ({ id: segment.id, label: segment.label }))}
        hideDueDate={hideDueDate}
        onClose={() => setCopySourceIds(null)}
        onConfirm={confirmCopy}
      />
    </>
  );
}
