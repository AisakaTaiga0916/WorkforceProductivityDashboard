"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { cn } from "@/lib/cn";
import { DEFAULT_TIME_ZONE, type KpiFrequencyCode } from "@/modules/tasks/kpi-recurrence";
import {
  MIN_SEGMENTED_SUBKPIS_FOR_CREATE,
  ensureUnsegmentedSegment,
  isUnsegmentedSegmentId,
  UNASSIGNED_SEGMENT_BLOCK_MESSAGE,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
  type SubKpiItem as SubKpi,
} from "@/modules/tasks/kpi-subkpis";
import type { SubKpiCompletionRequirements } from "@/modules/tasks/sub-kpi-completion-mode";
import { DraftSubTasksPopup } from "@/components/task-board/DraftSubTasksPopup";
import { ListChecks } from "lucide-react";

const INSIGHTS_VIEW_ONLY = false;

function normalizeTaskTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

const TASK_TITLE_INPUT_CLASS =
  "rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold tracking-tight text-zinc-900 outline-none ring-orange-500/30 placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

type MaintenanceFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "SemiAnnual" | "Yearly";

function maintenanceFrequencyToCode(freq: MaintenanceFrequency): KpiFrequencyCode {
  if (freq === "SemiAnnual") return "SEMI_ANNUAL";
  if (freq === "Yearly") return "YEARLY";
  return freq.toUpperCase() as KpiFrequencyCode;
}
type DraftSegmentRow = { id: string; label: string; items: SubKpi[]; dueDate?: string | null };

export type KpiDefinitionMaintenanceRecord = {
  id: string;
  title: string;
  mainTask?: string | null;
  isRecurring?: boolean;
  nonRecurringStartAt?: string | null;
  nonRecurringEndAt?: string | null;
  frequency: KpiFrequencyCode;
  createdAt: string;
  updatedAt: string;
  subKpis: unknown;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  periodCycleStartAt?: string | null;
  periodKey?: string | null;
  itProjectName?: string | null;
  itProjectPhase?: string | null;
  assignedAgent?: {
    id: string;
    name: string;
    team?: { name?: string | null } | null;
  } | null;
};

type Props = {
  /** Called after a successful create so parents can refresh KPI lists / metrics. */
  onMaintenanceRecordsUpdated?: (rows: KpiDefinitionMaintenanceRecord[]) => void;
  /** When true, omit outer card chrome (for use inside a popup). */
  embedded?: boolean;
};

export function KpiDefinitionConsole({
  onMaintenanceRecordsUpdated,
  embedded = false,
}: Props) {
  const [recurrenceTz, setRecurrenceTz] = useState(DEFAULT_TIME_ZONE);
  const [mainTaskDraft, setMainTaskDraft] = useState("");
  const [mainTaskTargetDateDraft, setMainTaskTargetDateDraft] = useState("");
  const [maintenanceIsRecurring, setMaintenanceIsRecurring] = useState(true);
  const [maintenanceFrequency, setMaintenanceFrequency] = useState<MaintenanceFrequency>("Daily");
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(1);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState(1);
  const [subKpisDraft, setSubKpisDraft] = useState<SubKpi[]>([]);
  const [draftUseSegments, setDraftUseSegments] = useState(false);
  const [completionCheckbox, setCompletionCheckbox] = useState(true);
  const [completionBeforeAfterScreenshots, setCompletionBeforeAfterScreenshots] = useState(false);
  const [completionScreenshotUpload, setCompletionScreenshotUpload] = useState(false);
  const [completionNumerical, setCompletionNumerical] = useState(false);
  const [invertedRecording, setInvertedRecording] = useState(false);
  const [numericalTargetDraft, setNumericalTargetDraft] = useState("");
  const [dailyPenaltyDraft, setDailyPenaltyDraft] = useState("");
  const [enableSubtaskAssignees, setEnableSubtaskAssignees] = useState(true);
  const [draftSubTasksOpen, setDraftSubTasksOpen] = useState(false);
  const [draftSegments, setDraftSegments] = useState<DraftSegmentRow[]>([]);
  const [scopedCompanyTeamId, setScopedCompanyTeamId] = useState("");
  const [rosterCompanies, setRosterCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [kpiMaintenanceAssignWork, setKpiMaintenanceAssignWork] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  useEffect(() => {
    if (successMessage) {
      const t = setTimeout(() => setSuccessMessage(null), 6000);
      return () => clearTimeout(t);
    }
  }, [successMessage]);
  function setError(msg: string | null) {
    setLocalError(msg);
    if (msg) setSuccessMessage(null);
  }
  function setOk(msg: string | null) {
    setSuccessMessage(msg);
    if (msg) setLocalError(null);
  }
  const [adminDesignatedCompanyId, setAdminDesignatedCompanyId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setRecurrenceTz(DEFAULT_TIME_ZONE);
      } catch {
        setRecurrenceTz(DEFAULT_TIME_ZONE);
      }
    });
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/me/staff-designated-company", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          designatedCompanyTeamId?: string | null;
          designatedCompanyName?: string | null;
        };
        if (data.designatedCompanyTeamId) {
          setAdminDesignatedCompanyId(data.designatedCompanyTeamId);
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    if (
      adminDesignatedCompanyId &&
      rosterCompanies.length > 0 &&
      rosterCompanies.some((c) => c.id === adminDesignatedCompanyId)
    ) {
      setScopedCompanyTeamId(adminDesignatedCompanyId);
      void loadAssignFlag(adminDesignatedCompanyId);
    }
    // loadAssignFlag is defined below; omit from deps to match prior pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on company/roster changes only
  }, [adminDesignatedCompanyId, rosterCompanies]);

  const kpiMaintenanceSearch = useMemo(
    () => `?tz=${encodeURIComponent(recurrenceTz)}`,
    [recurrenceTz],
  );

  const loadAssignFlag = useCallback(async (companyFilter?: string) => {
    const url = companyFilter
      ? `/api/kpi-maintenance${kpiMaintenanceSearch}&company=${encodeURIComponent(companyFilter)}`
      : `/api/kpi-maintenance${kpiMaintenanceSearch}`;
    const kpiRes = await fetch(url, { cache: "no-store" });
    if (kpiRes.ok) {
      const payload = (await kpiRes.json()) as {
        canAssignWork?: boolean;
        rows?: KpiDefinitionMaintenanceRecord[];
        rosterCompanies?: Array<{ id: string; name: string }>;
      };
      setKpiMaintenanceAssignWork(Boolean(payload.canAssignWork));
      setRosterCompanies(payload.rosterCompanies ?? []);
    }
  }, [kpiMaintenanceSearch]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAssignFlag();
    });
  }, [loadAssignFlag]);

  const draftSubKpiTotal = draftUseSegments
    ? draftSegments.reduce((a, s) => a + s.items.length, 0)
    : subKpisDraft.length;
  // Always offer "Segment this checklist" in the subtask popup (no min-count gate).
  const showSegmentedCreateOption = kpiMaintenanceAssignWork;

  const completionRequirements = useMemo<SubKpiCompletionRequirements>(
    () => ({
      checkbox: completionCheckbox,
      screenshots: completionBeforeAfterScreenshots,
      screenshotUpload: completionScreenshotUpload,
      numerical: completionNumerical,
    }),
    [completionCheckbox, completionBeforeAfterScreenshots, completionScreenshotUpload, completionNumerical],
  );

  function removeSubKpiDraft(id: string) {
    setSubKpisDraft((prev) => prev.filter((s) => s.id !== id));
  }

  function setDraftSegmentedMode(next: boolean) {
    if (!next) {
      const merged = draftSegments.flatMap((s) => s.items);
      setSubKpisDraft(merged);
      setDraftSegments([]);
      setDraftUseSegments(false);
      return;
    }
    setDraftUseSegments(true);
    const segmentLabel = mainTaskDraft.trim() || "Segment 1";
    if (subKpisDraft.length > 0) {
      // Existing flat items become Unsegmented; user can drag into named segments.
      setDraftSegments(
        ensureUnsegmentedSegment([
          {
            id: crypto.randomUUID(),
            label: segmentLabel,
            items: [],
          },
          {
            id: UNSEGMENTED_SEGMENT_ID,
            label: UNSEGMENTED_SEGMENT_LABEL,
            items: [...subKpisDraft],
          },
        ]),
      );
      setSubKpisDraft([]);
      return;
    }
    if (draftSegments.length === 0) {
      setDraftSegments(
        ensureUnsegmentedSegment([
          {
            id: crypto.randomUUID(),
            label: segmentLabel,
            items: [],
          },
        ]),
      );
    } else {
      setDraftSegments(ensureUnsegmentedSegment(draftSegments));
    }
  }

  /** Reset create-form fields after a successful save (or when clearing a draft). */
  function resetTaskDraftAfterCreate() {
    setMainTaskDraft("");
    setMainTaskTargetDateDraft("");
    setMaintenanceIsRecurring(true);
    setMaintenanceFrequency("Daily");
    setRecurrenceWeekday(1);
    setRecurrenceMonthDay(1);
    setSubKpisDraft([]);
    setDraftUseSegments(false);
    setDraftSegments([]);
    setDraftSubTasksOpen(false);
    setCompletionCheckbox(true);
    setCompletionBeforeAfterScreenshots(false);
    setCompletionScreenshotUpload(false);
    setCompletionNumerical(false);
    setInvertedRecording(false);
    setNumericalTargetDraft("");
    setDailyPenaltyDraft("");
    setEnableSubtaskAssignees(true);
    setLocalError(null);
  }

  async function createMaintenanceRecord() {
    if (INSIGHTS_VIEW_ONLY) return;
    if (!mainTaskDraft.trim()) {
      setError("Enter a main task name.");
      return;
    }
    // Title is the work-item name (API also derives this).
    const title = normalizeTaskTitle(mainTaskDraft);
    const freqUpper = !maintenanceIsRecurring
      ? ("MONTHLY" as KpiFrequencyCode)
      : maintenanceFrequencyToCode(maintenanceFrequency);

    if (draftUseSegments) {
      const ensured = ensureUnsegmentedSegment(draftSegments);
      const unassignedCount =
        ensured.find((seg) => isUnsegmentedSegmentId(seg.id))?.items.length ?? 0;
      if (unassignedCount > 0) {
        setError(UNASSIGNED_SEGMENT_BLOCK_MESSAGE);
        return;
      }
      for (const seg of ensured) {
        if (isUnsegmentedSegmentId(seg.id)) continue;
        if (!seg.label.trim()) {
          setError('Each checklist segment needs a label (or turn off "Segment this checklist").');
          return;
        }
      }
      const namedTotal = ensured
        .filter((seg) => !isUnsegmentedSegmentId(seg.id))
        .reduce((a, s) => a + s.items.length, 0);
      if (namedTotal < MIN_SEGMENTED_SUBKPIS_FOR_CREATE) {
        setError(
          `Assign at least ${MIN_SEGMENTED_SUBKPIS_FOR_CREATE} sub-task${MIN_SEGMENTED_SUBKPIS_FOR_CREATE === 1 ? "" : "s"} to a segment before creating the task.`,
        );
        return;
      }
    }

    if (
      !completionRequirements.checkbox &&
      !completionRequirements.screenshots &&
      !completionRequirements.screenshotUpload &&
      !completionRequirements.numerical
    ) {
      setError("Select at least one completion condition.");
      return;
    }

    if (completionRequirements.numerical) {
      const isPillarOnlyDraft = !draftUseSegments && subKpisDraft.length === 0;
      const skipTargetAtCreate = maintenanceIsRecurring && isPillarOnlyDraft;
      if (!skipTargetAtCreate) {
        const targetRaw = numericalTargetDraft.trim();
        const target = targetRaw === "" ? NaN : Number(targetRaw);
        if (!Number.isFinite(target)) {
          setError("Enter a target number for numerical record completion.");
          return;
        }
      }
    }

    const body: Record<string, unknown> = {
      title,
      frequency: freqUpper,
      isRecurring: maintenanceIsRecurring,
      enableSubtaskAssignees: enableSubtaskAssignees === true,
      mainTask: mainTaskDraft.trim(),
      completionRequirements,
      invertedRecording: invertedRecording === true,
    };
    if (scopedCompanyTeamId) body.scopedCompanyTeamId = scopedCompanyTeamId;
    if (completionRequirements.numerical) {
      const targetRaw = numericalTargetDraft.trim();
      if (targetRaw !== "") {
        body.numericalTarget = Number(targetRaw);
      }
    }
    if (!maintenanceIsRecurring) {
      const penaltyRaw = dailyPenaltyDraft.trim();
      if (penaltyRaw !== "") {
        const penalty = Number(penaltyRaw);
        if (!Number.isFinite(penalty) || penalty < 0) {
          setError("Daily delay penalty must be a non-negative number.");
          return;
        }
        body.taskDailyPenaltyAmount = penalty;
      }
    }
    if (draftUseSegments) {
      body.subKpisSegmented = true;
      body.segments = draftSegments.map((s) => ({
        id: s.id,
        label: s.label.trim(),
        items: s.items.map((it) => ({
          title: it.title.trim(),
          description: it.description ?? null,
          remarks: it.remarks ?? null,
          // Daily recurring omits sub-task target dates.
          dueDate: maintenanceIsRecurring && freqUpper === "DAILY" ? "" : it.dueDate ?? "",
          dueDateRollsWithCycle:
            maintenanceIsRecurring &&
            freqUpper !== "DAILY" &&
            Boolean(it.dueDate?.trim()) &&
            it.dueDateRollsWithCycle === true,
          projectPriority: it.projectPriority ?? null,
          projectStatus: it.projectStatus ?? null,
          done: it.done === true,
        })),
      }));
    } else {
      body.subKpis = subKpisDraft.map((s) => ({
        title: s.title,
        description: s.description ?? null,
        remarks: s.remarks ?? null,
        dueDate: maintenanceIsRecurring && freqUpper === "DAILY" ? "" : s.dueDate ?? "",
        dueDateRollsWithCycle:
          maintenanceIsRecurring &&
          freqUpper !== "DAILY" &&
          Boolean(s.dueDate?.trim()) &&
          s.dueDateRollsWithCycle === true,
        projectPriority: s.projectPriority ?? null,
      }));
    }
    if (!maintenanceIsRecurring && mainTaskTargetDateDraft.trim()) {
      body.pillarDueDate = mainTaskTargetDateDraft.trim();
    }

    if (maintenanceIsRecurring && freqUpper === "WEEKLY") {
      body.recurrenceWeekday = recurrenceWeekday;
    }
    if (maintenanceIsRecurring && (freqUpper === "MONTHLY" || freqUpper === "QUARTERLY" || freqUpper === "SEMI_ANNUAL" || freqUpper === "YEARLY")) {
      body.recurrenceMonthDay = recurrenceMonthDay;
    }
    body.timeZone = recurrenceTz;

    const res = await fetch(`/api/kpi-maintenance${kpiMaintenanceSearch}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (res.ok) {
      let message = "";
      try {
        const parsed = JSON.parse(raw) as { message?: string };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          message = parsed.message.trim();
        }
      } catch {
        // ignore parse errors on the message
      }
      if (message) {
        setOk(message);
      } else {
        setOk("Task created.");
      }
      setMainTaskDraft("");
      setMainTaskTargetDateDraft("");
      setMaintenanceIsRecurring(true);
      setMaintenanceFrequency("Daily");
      setRecurrenceWeekday(1);
      setRecurrenceMonthDay(1);
      setSubKpisDraft([]);
      setDraftUseSegments(false);
      setDraftSubTasksOpen(false);
      setCompletionCheckbox(true);
      setCompletionBeforeAfterScreenshots(false);
      setCompletionScreenshotUpload(false);
      setCompletionNumerical(false);
      setInvertedRecording(false);
      setNumericalTargetDraft("");
      setDailyPenaltyDraft("");
      setEnableSubtaskAssignees(true);
      setScopedCompanyTeamId("");
      setDraftSegments([]);
      const reload = await fetch(`/api/kpi-maintenance${kpiMaintenanceSearch}`, { cache: "no-store" });
      if (reload.ok) {
        const payload = (await reload.json()) as { rows: KpiDefinitionMaintenanceRecord[] };
        onMaintenanceRecordsUpdated?.(payload.rows);
      }
      void loadAssignFlag(adminDesignatedCompanyId ?? undefined);
      return;
    }
    let errMsg = "Could not create task.";
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error.trim()) errMsg = parsed.error.trim();
    } catch {
      if (raw.trim()) errMsg = raw.trim();
    }
    setError(errMsg);
  }

  /** Form is available whenever the operator can create work — no task-group pick required. */
  const formUnlocked = kpiMaintenanceAssignWork;

  return (
    <section
      className={
        embedded
          ? undefined
          : "mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-5 dark:border-zinc-800/90 dark:bg-[#0b1220] dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
      }
    >
      {!embedded ? (
        <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-600 dark:text-zinc-500">
          Add Task
        </h2>
      ) : null}
      {localError ? (
        <p className="mt-2 rounded-lg border border-red-500/35 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-200">
          {localError}
        </p>
      ) : null}
      {successMessage ? (
        <p className="mt-2 rounded-lg border border-emerald-500/35 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {successMessage}
        </p>
      ) : null}
      <div className={cn("grid gap-2.5 md:grid-cols-2", embedded ? "mt-0" : "mt-4")}>
        {kpiMaintenanceAssignWork ? (
          <p className="text-xs text-zinc-500 md:col-span-2 dark:text-zinc-400">
            Tasks can be recurring or one-off. Field travel is filed under{" "}
            <Link
              href="/work/work-plans"
              className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
            >
              Work → Work Plans
            </Link>
            ; projects (phases, timeline) under{" "}
            <Link
              href="/work/projects"
              className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
            >
              Work → Projects
            </Link>
            .
          </p>
        ) : null}
        {kpiMaintenanceAssignWork && formUnlocked ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 md:col-span-2">
            <input
              type="checkbox"
              checked={enableSubtaskAssignees}
              onChange={(e) => setEnableSubtaskAssignees(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
                Enable Subtask Assignees
              </span>
              <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-zinc-600 dark:text-zinc-400">
                When off, subtasks stay unassigned until the main assignee uses Seek Assistance.
              </span>
            </span>
          </label>
        ) : null}
        {formUnlocked ? (
          <div className="grid gap-3 md:col-span-2 md:grid-cols-[minmax(220px,1fr)_180px]">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              Main Task
              <input
                type="text"
                value={mainTaskDraft}
                onChange={(e) => {
                  setMainTaskDraft(e.target.value);
                  setLocalError(null);
                }}
                placeholder="e.g. Reroute Connections"
                required
                className={TASK_TITLE_INPUT_CLASS}
              />
            </label>
            {!maintenanceIsRecurring ? (
              <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
                Target date
                <DatePickerField
                  value={mainTaskTargetDateDraft}
                  onChange={(e) => setMainTaskTargetDateDraft(e.target.value)}
                  aria-label="Main task target date"
                  shellClassName="h-10"
                />
              </label>
            ) : null}
            <p className="text-xs font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400 md:col-span-2">
              Works for recurring and one-off schedules — with no sub-tasks, completion conditions apply on this main task on the Task Board.
              {!maintenanceIsRecurring
                ? " Target date applies when there are no sub-tasks (delayed the day after if incomplete)."
                : null}
            </p>
          </div>
        ) : null}
        {formUnlocked ? (
          <div className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
            Task schedule type
            <label className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
              <input
                type="checkbox"
                checked={maintenanceIsRecurring}
                onChange={(e) => {
                  const nextRecurring = e.target.checked;
                  setMaintenanceIsRecurring(nextRecurring);
                  if (nextRecurring) {
                    const recurringDaily = maintenanceFrequency === "Daily";
                    setMainTaskTargetDateDraft("");
                    setSubKpisDraft((prev) =>
                      prev.map((item) => {
                        const next = { ...item };
                        if (recurringDaily) {
                          delete next.startDate;
                          delete next.dueDate;
                          delete next.dueDateRollsWithCycle;
                        }
                        return next;
                      }),
                    );
                    setDraftSegments((prev) =>
                      prev.map((seg) => ({
                        ...seg,
                        items: seg.items.map((item) => {
                          const next = { ...item };
                          if (recurringDaily) {
                            delete next.startDate;
                            delete next.dueDate;
                            delete next.dueDateRollsWithCycle;
                          }
                          return next;
                        }),
                      })),
                    );
                  }
                }}
              />
              Recurring task
            </label>
          </div>
        ) : null}
        {formUnlocked && maintenanceIsRecurring ? (
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
            Frequency
            <select
              value={maintenanceFrequency}
              onChange={(e) => {
                const nextFrequency = e.target.value as MaintenanceFrequency;
                setMaintenanceFrequency(nextFrequency);
                if (maintenanceIsRecurring && nextFrequency === "Daily") {
                  setSubKpisDraft((prev) =>
                    prev.map((item) => {
                      const next = { ...item };
                      delete next.startDate;
                      delete next.dueDate;
                      delete next.dueDateRollsWithCycle;
                      return next;
                    }),
                  );
                  setDraftSegments((prev) =>
                    prev.map((seg) => ({
                      ...seg,
                      items: seg.items.map((item) => {
                        const next = { ...item };
                        delete next.startDate;
                        delete next.dueDate;
                        delete next.dueDateRollsWithCycle;
                        return next;
                      }),
                    })),
                  );
                }
              }}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none ring-orange-500/30 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="SemiAnnual">Semi Annual</option>
              <option value="Yearly">Annualy</option>
            </select>
          </label>
        ) : null}
        {formUnlocked &&
        maintenanceIsRecurring &&
        maintenanceFrequency === "Weekly" ? (
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
            Week starts on ({recurrenceTz})
            <select
              value={recurrenceWeekday}
              onChange={(e) => setRecurrenceWeekday(Number(e.target.value))}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none ring-orange-500/30 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
              <option value={6}>Saturday</option>
            </select>
          </label>
        ) : null}
        {formUnlocked &&
        maintenanceIsRecurring &&
        (maintenanceFrequency === "Monthly" ||
          maintenanceFrequency === "Quarterly" ||
          maintenanceFrequency === "SemiAnnual" ||
          maintenanceFrequency === "Yearly") ? (
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
            {maintenanceFrequency === "Quarterly"
              ? "4-month cycle"
              : maintenanceFrequency === "SemiAnnual"
                ? "6-month cycle"
                : maintenanceFrequency === "Yearly"
                  ? "Annualy cycle"
                  : "Month cycle"}{" "}
            starts on day (1–31, {recurrenceTz})
            <select
              value={recurrenceMonthDay}
              onChange={(e) => setRecurrenceMonthDay(Number(e.target.value))}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none ring-orange-500/30 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {maintenanceIsRecurring
                ? "Sub-tasks are optional. Without them, completion conditions apply on the main task each cycle."
                : "Sub-tasks are optional. Without them, set a main task target date and complete work on the main task — delayed the day after target if still incomplete."}
            </p>
            {formUnlocked ? (
              <button
                type="button"
                onClick={() => setDraftSubTasksOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-orange-500/60 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-800 hover:bg-orange-500/20 dark:border-orange-500/40 dark:text-orange-200 dark:hover:bg-orange-950/40"
              >
                <ListChecks className="size-3.5" aria-hidden />
                Add Sub Tasks
                <span className="rounded-full bg-orange-600 px-1.5 py-px text-[10px] font-bold text-white">
                  {draftSubKpiTotal}
                </span>
              </button>
              ) : null}
          </div>
        </div>
      </div>

      {formUnlocked ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-300">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
            Completion conditions
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Select one or more ways assignees can complete work on the Task Board. With no sub-tasks, these apply on
            the main task
            {maintenanceIsRecurring ? " (recurring and one-off)." : "."}
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={completionCheckbox}
                onChange={(e) => setCompletionCheckbox(e.target.checked)}
                className="mt-1"
              />
              <span>Checklist checkbox (default)</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={completionBeforeAfterScreenshots}
                onChange={(e) => setCompletionBeforeAfterScreenshots(e.target.checked)}
                className="mt-1"
              />
              <span>
                Before/after screenshot uploads
                <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Required on each sub-task, or on the main task when there are no sub-tasks.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={completionScreenshotUpload}
                onChange={(e) => setCompletionScreenshotUpload(e.target.checked)}
                className="mt-1"
              />
              <span>
                Screenshot upload
                <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Attach proof on each sub-task, or on the main task when there are no sub-tasks.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={completionNumerical}
                onChange={(e) => {
                  setCompletionNumerical(e.target.checked);
                  if (!e.target.checked) setNumericalTargetDraft("");
                }}
                className="mt-1"
              />
              <span>Numerical record (assignees enter a number when completing work)</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={invertedRecording}
                onChange={(e) => setInvertedRecording(e.target.checked)}
                className="mt-1"
              />
              <span>
                Inverted recording
                <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Unchecked items count as 100%. Checking boxes lowers the recorded percent (incident /
                  breach style).
                </span>
              </span>
            </label>
          </div>
          {completionNumerical ? (
            <label className="mt-3 flex max-w-xs flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              Target number
              <input
                type="number"
                step="any"
                value={numericalTargetDraft}
                onChange={(e) => setNumericalTargetDraft(e.target.value)}
                placeholder="e.g. 100"
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none ring-orange-500/30 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <span className="text-xs font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
                {maintenanceIsRecurring && subKpisDraft.length === 0
                  ? "Optional for recurring tasks with no sub-tasks — assignees set the target each cycle on the Task Board."
                  : "Assignees will see this target when recording their actual number on the Task Board."}
              </span>
            </label>
          ) : null}
          {!maintenanceIsRecurring ? (
            <label className="mt-3 flex max-w-xs flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              Daily delay penalty
              <input
                type="number"
                min={0}
                step="any"
                value={dailyPenaltyDraft}
                onChange={(e) => setDailyPenaltyDraft(e.target.value)}
                placeholder="e.g. 5"
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none ring-orange-500/30 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <span className="text-xs font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
                One-off tasks only. Applied per calendar day once a sub-task lands in Delayed (day after
                target date). Sub-task overrides can be set on the Task Board.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {formUnlocked ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void createMaintenanceRecord()} className="rounded-xl px-4">
              Apply
            </Button>
          </div>
          {draftSubKpiTotal > 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {draftSubKpiTotal} sub-task{draftSubKpiTotal === 1 ? "" : "s"} ready
              {draftUseSegments ? ` in ${draftSegments.length} segment${draftSegments.length === 1 ? "" : "s"}` : ""} — open{" "}
              <button
                type="button"
                onClick={() => setDraftSubTasksOpen(true)}
                className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
              >
                Add Sub Tasks
              </button>{" "}
              above to edit details, or click a chip below to remove.
            </p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Optional. Use Add Sub Tasks above to build a checklist, or Apply with none to use{" "}
              main-task completion.
            </p>
          )}
        </div>
      ) : null}

      {formUnlocked && !draftUseSegments && subKpisDraft.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {subKpisDraft.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => removeSubKpiDraft(s.id)}
              className="rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Remove sub-task"
            >
              {s.title}
              {s.projectPriority ? ` · ${s.projectPriority}` : ""}
              {s.dueDate ? ` · Target ${s.dueDate}${s.dueDateRollsWithCycle ? " · rolls" : ""}` : ""} ×
            </button>
          ))}
        </div>
      ) : null}

      <DraftSubTasksPopup
        open={draftSubTasksOpen && formUnlocked}
        taskLabel={mainTaskDraft.trim() || "New task"}
        items={subKpisDraft}
        segmented={draftUseSegments}
        segments={draftSegments}
        canSegment={showSegmentedCreateOption}
        canMakePhases={false}
        minimumSegmentItems={MIN_SEGMENTED_SUBKPIS_FOR_CREATE}
        hideDueDate={maintenanceIsRecurring && maintenanceFrequency === "Daily"}
        allowDueDateRollWithCycle={
          maintenanceIsRecurring && maintenanceFrequency !== "Daily"
        }
        parentDueDate={mainTaskTargetDateDraft}
        onChange={setSubKpisDraft}
        onSegmentedChange={setDraftSegmentedMode}
        onSegmentsChange={setDraftSegments}
        onClose={() => setDraftSubTasksOpen(false)}
      />
    </section>
  );
}

