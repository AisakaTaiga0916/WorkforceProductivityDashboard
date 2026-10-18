"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SubTaskDto } from "@/modules/tasks/kpi-subtasks-rest";
import {
  isUnsegmentedSegmentId,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
} from "@/modules/tasks/kpi-subkpis";
import { CopySubtaskToSegmentModal } from "@/components/task-board/CopySubtaskToSegmentModal";
import {
  SubTasksKanbanView,
  type SubtaskKanbanBoardModel,
  type SubtaskKanbanCard,
} from "@/components/task-board/SubTasksKanbanView";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { DatePickerField } from "@/components/ui/DatePickerField";

const PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const;

type SubTaskFormDraft = {
  title: string;
  description: string;
  remarks: string;
  dueDate: string;
  /** When false, due date is not stored and the subtask inherits the main task target. */
  useCustomDueDate: boolean;
  dueDateRollsWithCycle: boolean;
  priority: string;
  segmentId: string;
};

const EMPTY_DRAFT: SubTaskFormDraft = {
  title: "",
  description: "",
  remarks: "",
  dueDate: "",
  useCustomDueDate: false,
  dueDateRollsWithCycle: false,
  priority: "",
  segmentId: "",
};

type SubTasksManagerPopupProps = {
  open: boolean;
  taskId: string | null;
  /** Task card label shown in the popup header. */
  taskLabel: string;
  /** Admins can add/edit/delete; everyone else gets a read-only list. */
  canManage: boolean;
  /** Hide due-date inputs (daily recurring tasks don't use sub-task dates). */
  hideDueDate?: boolean;
  /** Show “adjust with each cycle” for recurring (non-daily) tasks. */
  allowDueDateRollWithCycle?: boolean;
  tz: string;
  onClose: () => void;
  /** Called after any successful mutation so the board can refresh its rows. */
  onChanged: () => void;
};

export function SubTasksManagerPopup({
  open,
  taskId,
  taskLabel,
  canManage,
  hideDueDate = false,
  allowDueDateRollWithCycle = false,
  tz,
  onClose,
  onChanged,
}: SubTasksManagerPopupProps) {
  const [subtasks, setSubtasks] = useState<SubTaskDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<SubTaskFormDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SubTaskFormDraft>(EMPTY_DRAFT);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [copySourceIds, setCopySourceIds] = useState<string[] | null>(null);
  const [taskDueDate, setTaskDueDate] = useState<string | null>(null);
  const [checklistSegmented, setChecklistSegmented] = useState(false);
  const [segmentDefs, setSegmentDefs] = useState<Array<{ id: string; label: string }>>([]);

  const segments = useMemo(() => {
    if (segmentDefs.length > 0) return segmentDefs;
    const seen = new Map<string, string>();
    for (const s of subtasks) {
      if (s.segmentId && !seen.has(s.segmentId)) {
        seen.set(s.segmentId, s.segmentLabel ?? s.segmentId);
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [segmentDefs, subtasks]);

  const namedSegments = useMemo(
    () => segments.filter((seg) => !isUnsegmentedSegmentId(seg.id)),
    [segments],
  );

  const canCopyToSegment = canManage && namedSegments.length > 0 && segments.length > 1;

  const copySources = useMemo(
    () => (copySourceIds ? subtasks.filter((s) => copySourceIds.includes(s.id)) : []),
    [copySourceIds, subtasks],
  );

  const kanbanBoards = useMemo((): SubtaskKanbanBoardModel[] => {
    if (!checklistSegmented && segments.length === 0) return [];
    const bySeg = new Map<string, SubtaskKanbanCard[]>();
    for (const seg of segments) bySeg.set(seg.id, []);
    if (!bySeg.has(UNSEGMENTED_SEGMENT_ID)) bySeg.set(UNSEGMENTED_SEGMENT_ID, []);

    for (const s of subtasks) {
      const segId = s.segmentId?.trim() || UNSEGMENTED_SEGMENT_ID;
      if (!bySeg.has(segId)) bySeg.set(segId, []);
      bySeg.get(segId)!.push({
        id: s.id,
        title: s.title,
        description: s.description,
        done: s.done,
        projectStatus:
          s.status === "On Going" || s.status === "Finalizing" || s.status === "Pending" || s.status === "Done"
            ? s.status
            : s.done
              ? "Done"
              : "Pending",
        priority: s.priority,
        dueLabel: s.effectiveDueDate
          ? s.inheritsDueDate
            ? `${s.effectiveDueDate} (main)`
            : `${s.effectiveDueDate}${s.dueDateRollsWithCycle ? " · rolls" : ""}`
          : null,
        segmentId: segId,
      });
    }

    const named = segments
      .filter((seg) => !isUnsegmentedSegmentId(seg.id))
      .map((seg) => ({
        id: seg.id,
        label: seg.label,
        items: bySeg.get(seg.id) ?? [],
      }));
    const generalItems = bySeg.get(UNSEGMENTED_SEGMENT_ID) ?? [];
    return [
      ...named,
      {
        id: UNSEGMENTED_SEGMENT_ID,
        label: UNSEGMENTED_SEGMENT_LABEL,
        items: generalItems,
      },
    ];
  }, [checklistSegmented, segments, subtasks]);

  function applyListPayload(payload: {
    subtasks: SubTaskDto[];
    taskDueDate?: string | null;
    segmented?: boolean;
    segments?: Array<{ id: string; label: string }>;
  }) {
    setSubtasks(payload.subtasks);
    if (payload.taskDueDate !== undefined) setTaskDueDate(payload.taskDueDate ?? null);
    if (typeof payload.segmented === "boolean") setChecklistSegmented(payload.segmented);
    if (Array.isArray(payload.segments)) setSegmentDefs(payload.segments);
  }

  const loadSubtasks = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/kpi-maintenance/${encodeURIComponent(taskId)}/subtasks`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not load sub-tasks.");
        return;
      }
      const payload = (await res.json()) as {
        subtasks: SubTaskDto[];
        taskDueDate?: string | null;
        segmented?: boolean;
        segments?: Array<{ id: string; label: string }>;
      };
      applyListPayload(payload);
    } catch {
      setError("Could not load sub-tasks. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Reset per-task state during render when the popup opens for a (new) task.
  const activeKey = open && taskId ? taskId : null;
  const [resetKey, setResetKey] = useState<string | null>(null);
  if (activeKey !== resetKey) {
    setResetKey(activeKey);
    if (activeKey) {
      setSubtasks([]);
      setAddDraft(EMPTY_DRAFT);
      setEditingId(null);
      setError(null);
      setSuccess(null);
      setSelectedIds(new Set());
      setCopySourceIds(null);
      setTaskDueDate(null);
      setChecklistSegmented(false);
      setSegmentDefs([]);
      setLoading(true);
    }
  }

  useEffect(() => {
    if (!open || !taskId) return;
    queueMicrotask(() => {
      void loadSubtasks();
    });
  }, [open, taskId, loadSubtasks]);

  if (!open || !taskId) return null;

  async function runMutation(request: () => Promise<Response>, failMessage: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await request();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? failMessage);
        return null;
      }
      const payload = (await res.json()) as {
        subtasks: SubTaskDto[];
        copiedCount?: number;
        taskDueDate?: string | null;
        segmented?: boolean;
        segments?: Array<{ id: string; label: string }>;
      };
      applyListPayload(payload);
      onChanged();
      return payload;
    } catch {
      setError(failMessage);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addSubTask() {
    const title = addDraft.title.trim();
    if (!title) {
      setError("Sub Task title is required.");
      return;
    }
    if (!hideDueDate && addDraft.useCustomDueDate && !addDraft.dueDate) {
      setError("Choose a custom target date, or uncheck the option to inherit the main task date.");
      return;
    }
    // New subtasks always land on the Unassigned column when segmented.
    const segmentId = checklistSegmented ? UNSEGMENTED_SEGMENT_ID : null;
    const payload = await runMutation(
      () =>
        fetch(`/api/kpi-maintenance/${encodeURIComponent(taskId!)}/subtasks?tz=${encodeURIComponent(tz)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            description: addDraft.description.trim() || null,
            remarks: addDraft.remarks.trim() || null,
            dueDate:
              hideDueDate || !addDraft.useCustomDueDate ? null : addDraft.dueDate || null,
            dueDateRollsWithCycle:
              hideDueDate || !addDraft.useCustomDueDate
                ? false
                : Boolean(allowDueDateRollWithCycle && addDraft.dueDateRollsWithCycle),
            priority: addDraft.priority || null,
            segmentId,
          }),
        }),
      "Could not add the sub-task.",
    );
    if (payload) setAddDraft(EMPTY_DRAFT);
  }

  async function moveCardOnKanban(itemId: string, targetSegmentId: string) {
    // Optimistic: move into the target segment column (status unchanged).
    setSubtasks((prev) =>
      prev.map((s) => {
        if (s.id !== itemId) return s;
        const seg = segments.find((x) => x.id === targetSegmentId);
        return {
          ...s,
          segmentId: targetSegmentId,
          segmentLabel:
            seg?.label ??
            (isUnsegmentedSegmentId(targetSegmentId) ? UNSEGMENTED_SEGMENT_LABEL : s.segmentLabel),
        };
      }),
    );
    const payload = await runMutation(
      () =>
        fetch(
          `/api/kpi-maintenance/${encodeURIComponent(taskId!)}/subtasks/${encodeURIComponent(itemId)}?tz=${encodeURIComponent(tz)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ segmentId: targetSegmentId }),
          },
        ),
      "Could not move the sub-task.",
    );
    if (!payload) void loadSubtasks();
  }

  function startEditing(s: SubTaskDto) {
    setEditingId(s.id);
    setEditDraft({
      title: s.title,
      description: s.description ?? "",
      remarks: s.remarks ?? "",
      dueDate: s.dueDate ?? "",
      useCustomDueDate: !s.inheritsDueDate && Boolean(s.dueDate),
      dueDateRollsWithCycle: s.dueDateRollsWithCycle === true,
      priority: s.priority ?? "",
      segmentId: s.segmentId ?? "",
    });
    setError(null);
    setSuccess(null);
  }

  async function saveEdit(subtaskId: string) {
    const title = editDraft.title.trim();
    if (!title) {
      setError("Sub Task title is required.");
      return;
    }
    if (!hideDueDate && editDraft.useCustomDueDate && !editDraft.dueDate) {
      setError("Choose a custom target date, or uncheck the option to inherit the main task date.");
      return;
    }
    const payload = await runMutation(
      () =>
        fetch(
          `/api/kpi-maintenance/${encodeURIComponent(taskId!)}/subtasks/${encodeURIComponent(subtaskId)}?tz=${encodeURIComponent(tz)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title,
              description: editDraft.description.trim() || null,
              remarks: editDraft.remarks.trim() || null,
              ...(hideDueDate
                ? {}
                : {
                    dueDate: editDraft.useCustomDueDate ? editDraft.dueDate || null : null,
                    dueDateRollsWithCycle: editDraft.useCustomDueDate
                      ? Boolean(allowDueDateRollWithCycle && editDraft.dueDateRollsWithCycle)
                      : false,
                  }),
              priority: editDraft.priority || null,
            }),
          },
        ),
      "Could not update the sub-task.",
    );
    if (payload) setEditingId(null);
  }

  async function deleteSubTask(s: SubTaskDto) {
    if (!window.confirm(`Delete sub-task "${s.title}"? This cannot be undone.`)) return;
    await runMutation(
      () =>
        fetch(
          `/api/kpi-maintenance/${encodeURIComponent(taskId!)}/subtasks/${encodeURIComponent(s.id)}?tz=${encodeURIComponent(tz)}`,
          { method: "DELETE" },
        ),
      "Could not delete the sub-task.",
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

  async function confirmCopy(opts: {
    targetSegmentIds: string[];
    keepDueDate: boolean;
    keepAssignee: boolean;
    keepPriority: boolean;
  }) {
    if (!copySourceIds?.length) return;
    const payload = await runMutation(
      () =>
        fetch(
          `/api/kpi-maintenance/${encodeURIComponent(taskId!)}/subtasks/copy?tz=${encodeURIComponent(tz)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sourceIds: copySourceIds,
              targetSegmentIds: opts.targetSegmentIds,
              keepDueDate: opts.keepDueDate,
              keepAssignee: opts.keepAssignee,
              keepPriority: opts.keepPriority,
            }),
          },
        ),
      "Could not copy the sub-task(s).",
    );
    if (!payload) return;
    const n = payload.copiedCount ?? 0;
    setSuccess(
      n === 1
        ? "Copied 1 sub-task to the selected segment(s)."
        : `Copied ${n} sub-task${n === 1 ? "" : "s"} to the selected segment(s).`,
    );
    setCopySourceIds(null);
    setSelectedIds(new Set());
  }

  function renderFormFields(
    draft: SubTaskFormDraft,
    patch: (next: Partial<SubTaskFormDraft>) => void,
    idPrefix: string,
  ) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500 sm:col-span-2">
          Title
          <input
            type="text"
            value={draft.title}
            disabled={busy}
            placeholder="Sub Task title"
            onChange={(e) => patch({ title: e.target.value })}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500 sm:col-span-2">
          Description
          <textarea
            value={draft.description}
            disabled={busy}
            rows={2}
            placeholder="Optional details about this sub-task"
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
            disabled={busy}
            rows={2}
            placeholder="Optional remarks or notes"
            onChange={(e) => patch({ remarks: e.target.value })}
            className="mt-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {!hideDueDate ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={draft.useCustomDueDate}
                disabled={busy}
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
                    {taskDueDate
                      ? `Will use main task target date (${taskDueDate})`
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
                    disabled={busy}
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
                      disabled={busy}
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
        ) : null}
        <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          Priority
          <select
            value={draft.priority}
            disabled={busy}
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

  const priorityBadgeClass = (priority: string) =>
    priority === "High"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : priority === "Medium"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";

  function renderSubtaskCard(s: SubTaskDto, options?: { hideSegmentLabel?: boolean }) {
    return (
      <div
        key={s.id}
        className={cn(
          "rounded-lg border border-zinc-200/80 bg-white/60 p-3 dark:border-zinc-700 dark:bg-zinc-950/40",
          s.done &&
            "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/20",
        )}
      >
        {editingId === s.id ? (
          <div className="space-y-2">
            {renderFormFields(editDraft, (next) => setEditDraft((prev) => ({ ...prev, ...next })), "Edit")}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !editDraft.title.trim()}
                onClick={() => void saveEdit(s.id)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save changes
              </button>
              <button
                type="button"
                disabled={busy}
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
                    disabled={busy}
                    onChange={() => toggleSelected(s.id)}
                    className="mt-1 size-3.5 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                    aria-label={`Select ${s.title}`}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-semibold text-zinc-900 dark:text-zinc-100",
                      s.done && "line-through opacity-70",
                    )}
                  >
                    {s.title}
                  </p>
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
                  {!options?.hideSegmentLabel && s.segmentLabel ? (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                      {s.segmentLabel}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {s.priority ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      priorityBadgeClass(s.priority),
                    )}
                  >
                    {s.priority}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    s.done
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >

                  {s.status}
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {s.assignee ? `Assigned to ${s.assignee.name}` : "Unassigned"}
                {s.effectiveDueDate
                  ? s.inheritsDueDate
                    ? ` · Target ${s.effectiveDueDate} (from main task)`
                    : ` · Target ${s.effectiveDueDate}${s.dueDateRollsWithCycle ? " · rolls with cycle" : ""}`
                  : s.inheritsDueDate
                    ? " · Uses main task target date"
                    : ""}
              </p>
              {canManage ? (
                <div className="flex items-center gap-1.5">
                  {canCopyToSegment ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSuccess(null);
                        setCopySourceIds([s.id]);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-orange-500/60 px-2.5 py-1 text-[10px] font-semibold text-orange-800 hover:bg-orange-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-500/40 dark:text-orange-200 dark:hover:bg-orange-950/40"
                    >
                      <Copy className="size-3" aria-hidden />
                      Copy to Segment
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEditing(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Pencil className="size-3" aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteSubTask(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-rose-400/60 px-2.5 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-3" aria-hidden />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <TaskBoardPopup
        open={open}
        title="Sub Tasks"
        description={`Manage the sub-tasks of "${taskLabel}".`}
        onClose={onClose}
        size="xl"
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </button>

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
                  disabled={busy}
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSuccess(null);
                    setCopySourceIds([...selectedIds]);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-orange-500 bg-orange-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  <Copy className="size-3" aria-hidden />
                  Copy to Segment
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading sub-tasks…
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-500">
                {subtasks.length} sub-task{subtasks.length === 1 ? "" : "s"}
                {checklistSegmented ? " · Drag cards between Unassigned and segment columns" : ""}
                {canCopyToSegment ? " · Select multiple to copy" : ""}
              </p>
              {checklistSegmented && kanbanBoards.length > 0 ? (
                <SubTasksKanbanView
                  boards={kanbanBoards}
                  canManage={canManage}
                  busy={busy}
                  selectedIds={canCopyToSegment ? selectedIds : undefined}
                  onToggleSelected={canCopyToSegment ? toggleSelected : undefined}
                  onDropCard={(itemId, targetSegmentId) => {
                    void moveCardOnKanban(itemId, targetSegmentId);
                  }}
                  renderCardActions={
                    canManage
                      ? (card) => (
                          <>
                            {canCopyToSegment ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setSuccess(null);
                                  setCopySourceIds([card.id]);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-orange-500/60 px-2 py-0.5 text-[9px] font-semibold text-orange-800 hover:bg-orange-500/10 disabled:opacity-50 dark:text-orange-200"
                              >
                                <Copy className="size-2.5" aria-hidden />
                                Copy
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const s = subtasks.find((x) => x.id === card.id);
                                if (s) startEditing(s);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-[9px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                            >
                              <Pencil className="size-2.5" aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const s = subtasks.find((x) => x.id === card.id);
                                if (s) void deleteSubTask(s);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-rose-400/60 px-2 py-0.5 text-[9px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300"
                            >
                              <Trash2 className="size-2.5" aria-hidden />
                              Delete
                            </button>
                          </>
                        )
                      : undefined
                  }
                />
              ) : subtasks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  No sub-tasks yet. Add the first one below.
                </p>
              ) : (
                <div className="space-y-2">{subtasks.map((s) => renderSubtaskCard(s))}</div>
              )}
              {editingId ? (
                <div className="rounded-lg border border-orange-400/40 bg-orange-500/[0.06] p-3 dark:border-orange-500/30">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
                    Edit Sub Task
                  </p>
                  {renderFormFields(editDraft, (next) => setEditDraft((prev) => ({ ...prev, ...next })), "Edit")}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || !editDraft.title.trim()}
                      onClick={() => void saveEdit(editingId)}
                      className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {canManage && !loading ? (
            <div className="rounded-lg border border-dashed border-orange-400/50 bg-orange-500/[0.04] p-3 dark:border-orange-500/35 dark:bg-orange-500/[0.07]">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
                Add Sub Task
              </p>
              <div className="mt-2 space-y-2">
                {renderFormFields(addDraft, (next) => setAddDraft((prev) => ({ ...prev, ...next })), "New sub-task")}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {checklistSegmented
                      ? "New sub-tasks land on Unassigned. Drag them onto a segment column — the task cannot finalize while Unassigned still has cards."
                      : "Add a title to create a new sub-task."}
                  </p>
                  <button
                    type="button"
                    disabled={busy || !addDraft.title.trim()}
                    onClick={() => void addSubTask()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="size-3.5" aria-hidden />
                    )}
                    Add Sub Task
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </TaskBoardPopup>

      <CopySubtaskToSegmentModal
        open={Boolean(copySourceIds?.length)}
        sourceTitles={copySources.map((s) => s.title)}
        sourceSegmentIds={copySources.map((s) => s.segmentId ?? "").filter(Boolean)}
        segments={segments}
        busy={busy}
        hideDueDate={hideDueDate}
        onClose={() => setCopySourceIds(null)}
        onConfirm={confirmCopy}
      />
    </>
  );
}
