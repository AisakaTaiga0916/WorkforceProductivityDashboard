"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { WorkPlanApprovalRecommendationGuide } from "@/components/task-board/WorkPlanApprovalRecommendationGuide";
import { WorkPlanFormFields } from "@/components/task-board/WorkPlanFormFields";
import { WorkPlanSectionChecklist } from "@/components/task-board/WorkPlanSectionChecklist";
import { CompanyUserSearchField } from "@/components/tickets/CompanyUserSearchField";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { TravelOrderOfflineBanner } from "@/components/offline/TravelOrderOfflineBanner";
import {
  cacheAgents,
  deleteOfflineDraft,
  getOfflineDraft,
  listCachedAgents,
  newTravelOrderOfflineId,
  offlineDraftHasContent,
  saveOfflineDraft,
} from "@/lib/offline/travel-order-offline-db";
import {
  isBrowserOnline,
  queueFieldAssignmentCreate,
  fetchTravelOrderWithTimeout,
  isTravelOrderNetworkFailure,
} from "@/lib/offline/travel-order-sync";
import { type TravelOrderApprovalLevelDraft } from "@/lib/travel-order";
import {
  WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
  WORK_PLAN_WIZARD_STEPS,
  buildWorkPlanApprovalLevelsFromSeats,
  deriveWorkPlanOrderRequest,
  emptyWorkPlanDraft,
  emptyPersonnelRow,
  applyWorkPlanRequestorDefaults,
  formatWorkPlanAmount,
  isWorkPlanSectionComplete,
  sumWorkPlanBudgetLines,
  validateWorkPlanDraft,
  workPlanVenueLabels,
  type WorkPlanDraft,
  type WorkPlanSectionId,
} from "@/lib/work-plan";
import { collapseDuplicateDesignation } from "@/lib/org-chart-executive-titles";
import type { WorkPlanOrgChartApprovalPath } from "@/lib/work-plan-org-chart-path";

type AgentOption = {
  id: string;
  name: string;
  email?: string | null;
  orgChartLayer?: number | null;
  subtitle?: string | null;
};

type TravelOrderRequestModalProps = {
  open: boolean;
  taskGroupTitle?: string;
  mainTaskName?: string;
  scopedCompanyTeamId?: string | null;
  companyScopeAgentId?: string | null;
  allowEditDetails?: boolean;
  resumeLocalId?: string | null;
  onClose: () => void;
  onCreated: (payload: {
    kpiId: string;
    travelOrderId?: string | null;
    offlineQueued?: boolean;
  }) => void;
  onDraftSaved?: () => void;
};

/**
 * Create Work Plan for Management Approval (Field Assignment):
 * Wizard intake — sections I–VI and approvals up to Layer 2.
 */
export function TravelOrderRequestModal({
  open,
  taskGroupTitle: _unusedTaskGroupTitle = "Travel Orders",
  mainTaskName = "",
  scopedCompanyTeamId,
  companyScopeAgentId = null,
  allowEditDetails: _allowEditDetails = false,
  resumeLocalId = null,
  onClose,
  onCreated,
  onDraftSaved,
}: TravelOrderRequestModalProps) {
  void _unusedTaskGroupTitle;
  void _allowEditDetails;
  const online = useOnlineStatus();
  const [localDraftId, setLocalDraftId] = useState(() => newTravelOrderOfflineId("todraft"));
  const [draft, setDraft] = useState<WorkPlanDraft>(() => emptyWorkPlanDraft());
  const [allAgents, setAllAgents] = useState<AgentOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [confirmDiscardDraft, setConfirmDiscardDraft] = useState(false);
  const [orgPath, setOrgPath] = useState<WorkPlanOrgChartApprovalPath | null>(null);
  const [orgPathLoading, setOrgPathLoading] = useState(false);
  const [orgPathError, setOrgPathError] = useState<string | null>(null);
  const [wizardStepId, setWizardStepId] = useState<WorkPlanSectionId>("general");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietAutosaveClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveMainTask =
    deriveWorkPlanOrderRequest(draft.workPlan).slice(0, 160) ||
    mainTaskName.trim() ||
    "Travel Order for Management Approval";

  /** Prefer org-chart members at Layer 2 and below (Layer 1 is excluded). */
  const approvalAgents = useMemo(() => {
    const designationById = new Map<string, string>();
    for (const seat of orgPath?.seats ?? []) {
      const id = seat.agentId?.trim();
      const designation = seat.hint?.trim();
      if (id && designation) designationById.set(id, designation);
    }
    const withDesignation = (agent: AgentOption): AgentOption => ({
      ...agent,
      subtitle:
        collapseDuplicateDesignation(
          designationById.get(agent.id) || agent.subtitle || "",
        ) || null,
    });
    const onChart = allAgents
      .filter(
        (a) =>
          typeof a.orgChartLayer === "number" &&
          a.orgChartLayer >= WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
      )
      .map(withDesignation);
    return onChart.length > 0 ? onChart : allAgents.map(withDesignation);
  }, [allAgents, orgPath]);

  const personnelCount = draft.workPlan.personnel.filter((p) => p.name.trim()).length;
  const budgetTotal = sumWorkPlanBudgetLines(draft.workPlan.budgetLines);
  const approvalLevels =
    draft.approvalLevels.length > 0
      ? draft.approvalLevels
      : [{ level: 1, agentId: "", optional: false }];
  const approversFilled = approvalLevels.filter((l) => l.agentId.trim()).length;
  const approversTotal = approvalLevels.length;

  const completeById = useMemo(() => {
    const map: Partial<Record<WorkPlanSectionId, boolean>> = {};
    for (const item of WORK_PLAN_WIZARD_STEPS) {
      map[item.id] = isWorkPlanSectionComplete(item.id, draft);
    }
    return map;
  }, [draft]);

  const wizardIndex = Math.max(
    0,
    WORK_PLAN_WIZARD_STEPS.findIndex((s) => s.id === wizardStepId),
  );
  const wizardStep = WORK_PLAN_WIZARD_STEPS[wizardIndex] ?? WORK_PLAN_WIZARD_STEPS[0]!;
  const isFirstStep = wizardIndex <= 0;
  const isLastStep = wizardIndex >= WORK_PLAN_WIZARD_STEPS.length - 1;
  const wizardProgress = Math.round(((wizardIndex + 1) / WORK_PLAN_WIZARD_STEPS.length) * 100);

  const periodVenueShort = [
    draft.workPlan.implementationPeriod.trim(),
    workPlanVenueLabels(draft.workPlan).join(" · "),
  ]
    .filter(Boolean)
    .join(" · ");

  function goToStep(id: WorkPlanSectionId) {
    setWizardStepId(id);
    setError(null);
  }

  function goBack() {
    if (isFirstStep) return;
    const prev = WORK_PLAN_WIZARD_STEPS[wizardIndex - 1];
    if (prev) goToStep(prev.id);
  }

  function goNext() {
    if (!isWorkPlanSectionComplete(wizardStep.id, draft)) {
      setError(`Complete ${wizardStep.title} before continuing.`);
      return;
    }
    if (isLastStep) return;
    const next = WORK_PLAN_WIZARD_STEPS[wizardIndex + 1];
    if (next) goToStep(next.id);
  }

  function firstIncompleteStepId(): WorkPlanSectionId | null {
    for (const step of WORK_PLAN_WIZARD_STEPS) {
      if (!isWorkPlanSectionComplete(step.id, draft)) return step.id;
    }
    return null;
  }

  function levelsWithLabels(
    levels: TravelOrderApprovalLevelDraft[],
    seats: WorkPlanOrgChartApprovalPath["seats"] | null | undefined,
  ) {
    return levels.map((lvl) => {
      const seat = seats?.find((s) => s.sequenceLevel === lvl.level);
      return {
        ...lvl,
        label: "Approved by",
      };
    });
  }

  function parseAgentList(list: unknown): AgentOption[] {
    if (!Array.isArray(list)) return [];
    return list
      .map((row) => {
        const r = row as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : "";
        const name = typeof r.name === "string" ? r.name : "";
        if (!id || !name) return null;
        return {
          id,
          name,
          email: typeof r.email === "string" ? r.email : null,
          orgChartLayer:
            typeof r.orgChartLayer === "number" && Number.isFinite(r.orgChartLayer)
              ? Math.floor(r.orgChartLayer)
              : null,
          subtitle: collapseDuplicateDesignation(
            typeof r.departmentDesignation === "string"
              ? r.departmentDesignation
              : typeof r.subtitle === "string"
                ? r.subtitle
                : "",
          ) || null,
        };
      })
      .filter(Boolean) as AgentOption[];
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setDraftNotice(null);
    setQueuedOffline(false);
    setConfirmDiscardDraft(false);
    setOrgPath(null);
    setOrgPathError(null);
    setWizardStepId("general");

    // Warm-compile create + org-chart path while the user fills the form
    // (dev cold compile often exceeds the short travel-order fetch timeout).
    if (isBrowserOnline()) {
      void fetch("/api/kpi-maintenance/field-assignment", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      }).catch(() => undefined);
      void fetch("/api/travel-orders/work-plan-org-chart-path", {
        cache: "no-store",
        credentials: "same-origin",
      }).catch(() => undefined);
    }

    void (async () => {
      if (resumeLocalId) {
        const existing = await getOfflineDraft(resumeLocalId).catch(() => undefined);
        if (cancelled) return;
        if (existing?.workPlanDraft) {
          setLocalDraftId(existing.localId);
          setDraft(emptyWorkPlanDraft(existing.workPlanDraft));
        } else {
          setLocalDraftId(newTravelOrderOfflineId("todraft"));
          setDraft(emptyWorkPlanDraft());
        }
      } else {
        setLocalDraftId(newTravelOrderOfflineId("todraft"));
        setDraft(emptyWorkPlanDraft());
      }

      if (isBrowserOnline()) {
        void fetch("/api/me/staff-designated-company", {
          cache: "no-store",
          credentials: "same-origin",
        })
          .then(async (res) => {
            if (!res.ok || cancelled) return;
            const body = (await res.json().catch(() => ({}))) as {
              designatedCompanyName?: string | null;
            };
            const name = body.designatedCompanyName?.trim() || "";
            if (!name) return;
            setDraft((prev) =>
              applyWorkPlanRequestorDefaults(prev, { designatedCompanyName: name }),
            );
          })
          .catch(() => undefined);
      }

      try {
        if (isBrowserOnline()) {
          const res = await fetchTravelOrderWithTimeout(
            "/api/agents?anyCompany=1&lite=1&includeOrgChartLayer=1",
            { cache: "no-store" },
            15000,
          );
          const raw = (await res.json().catch(() => null)) as unknown;
          const list = parseAgentList(
            Array.isArray(raw) ? raw : (raw as { agents?: unknown })?.agents,
          );
          if (!cancelled && list.length > 0) {
            setAllAgents(list);
            void cacheAgents(
              list.map((a) => ({
                ...a,
                cachedAt: new Date().toISOString(),
              })),
            ).catch(() => undefined);
            return;
          }
        }
      } catch {
        /* fall through to cache */
      }
      const cached = await listCachedAgents().catch(() => []);
      if (!cancelled) setAllAgents(cached);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, resumeLocalId]);

  useEffect(() => {
    if (!open) return;
    if (!isBrowserOnline()) {
      setOrgPath(null);
      return;
    }
    let cancelled = false;
    setOrgPathLoading(true);
    setOrgPathError(null);
    const requestorId = companyScopeAgentId?.trim() || "";
    const qs = requestorId
      ? `?agentId=${encodeURIComponent(requestorId)}`
      : "";
    void (async () => {
      const url = `/api/travel-orders/work-plan-org-chart-path${qs}`;
      async function loadOnce(timeoutMs: number) {
        const res = await fetchTravelOrderWithTimeout(url, { cache: "no-store" }, timeoutMs);
        const body = (await res.json().catch(() => ({}))) as WorkPlanOrgChartApprovalPath & {
          error?: string;
        };
        return { res, body };
      }
      try {
        let result: Awaited<ReturnType<typeof loadOnce>>;
        try {
          result = await loadOnce(45_000);
        } catch {
          result = await loadOnce(45_000);
        }
        const { res, body } = result;
        if (cancelled) return;
        if (!res.ok) {
          setOrgPathError(body.error ?? "Could not load org-chart recommendations.");
          setOrgPath(null);
          return;
        }
        setOrgPathError(body.error?.trim() || null);
        setOrgPath(body);
        // Ensure recommended people appear in the picker list.
        setAllAgents((prev) => {
          const byId = new Map(prev.map((a) => [a.id, a]));
          for (const seat of body.seats ?? []) {
            const id = seat?.agentId?.trim() || "";
            if (!id) continue;
            const designation =
              collapseDuplicateDesignation(seat.hint) || null;
            const existing = byId.get(id);
            if (existing) {
              byId.set(id, {
                ...existing,
                subtitle:
                  collapseDuplicateDesignation(
                    designation || existing.subtitle || "",
                  ) || null,
              });
              continue;
            }
            byId.set(id, {
              id,
              name: seat.agentName?.trim() || "Approver",
              email: null,
              orgChartLayer: seat.orgChartLayer,
              subtitle: designation,
            });
          }
          const confirmerId = body.recommendedConfirmation?.agentId?.trim() || "";
          if (confirmerId && !byId.has(confirmerId)) {
            byId.set(confirmerId, {
              id: confirmerId,
              name: body.recommendedConfirmation?.agentName?.trim() || "Confirmer",
              email: null,
              subtitle:
                collapseDuplicateDesignation(
                  body.recommendedConfirmation?.sectionName ||
                    body.recommendedConfirmation?.hint ||
                    "",
                ) || null,
            });
          }
          const headId = body.defaults?.departmentHeadAgentId?.trim() || "";
          if (headId && !byId.has(headId)) {
            byId.set(headId, {
              id: headId,
              name: body.defaults?.departmentHeadName?.trim() || "Department head",
              email: null,
            });
          }
          return [...byId.values()];
        });
        // Prefill empty seats once (resume drafts keep their own choices).
        setDraft((prev) => {
          let next = applyWorkPlanRequestorDefaults(prev, body.defaults);
          if (!next.confirmationByAgentId.trim()) {
            const confirmerId = body.recommendedConfirmation?.agentId?.trim() || "";
            if (confirmerId) next = { ...next, confirmationByAgentId: confirmerId };
          }
          if (next.approvalLevels.some((l) => l.agentId.trim())) return next;
          const levels = buildWorkPlanApprovalLevelsFromSeats(body.seats ?? []);
          if (levels.length === 0) return next;
          return { ...next, approvalLevels: levels };
        });
      } catch {
        if (!cancelled) {
          setOrgPathError("Could not load org-chart recommendations.");
          setOrgPath(null);
        }
      } finally {
        if (!cancelled) setOrgPathLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, companyScopeAgentId]);

  useEffect(() => {
    if (!open || !companyScopeAgentId) return;
    setDraft((prev) => {
      const hasNamedPersonnel = prev.workPlan.personnel.some((p) => p.name.trim());
      if (hasNamedPersonnel) return prev;
      const self = allAgents.find((a) => a.id === companyScopeAgentId);
      if (!self) return prev;
      const personnel = [
        emptyPersonnelRow({
          name: self.name,
          positionDepartment:
            (self.subtitle ?? "").trim() ||
            prev.workPlan.requestingParty,
          responsibilityRole: "Requestor",
        }),
      ];
      return {
        ...prev,
        workPlan: {
          ...prev.workPlan,
          personnel,
          totalPersonnel: 1,
        },
      };
    });
  }, [open, companyScopeAgentId, allAgents]);

  async function saveDraftLocal(options?: { quiet?: boolean }) {
    const quiet = options?.quiet === true;
    setDraftSaving(true);
    if (!quiet) setError(null);
    try {
      await saveOfflineDraft({
        localId: localDraftId,
        mainTaskName: effectiveMainTask,
        scopedCompanyTeamId: scopedCompanyTeamId ?? null,
        companyScopeAgentId,
        workPlanDraft: draft,
        draft: null,
        attachmentNames: [],
        syncStatus: "draft",
      });
      if (quiet) {
        setDraftNotice("Autosaved");
        if (quietAutosaveClearRef.current) clearTimeout(quietAutosaveClearRef.current);
        quietAutosaveClearRef.current = setTimeout(() => {
          setDraftNotice((prev) => (prev === "Autosaved" ? null : prev));
        }, 2000);
        // Quiet autosave must not notify the parent — onDraftSaved closes the create modal.
      } else {
        setDraftNotice("Draft saved. You can resume it from Travel Orders.");
        onDraftSaved?.();
      }
    } catch (err) {
      if (!quiet) {
        setError(err instanceof Error ? err.message : "Could not save draft.");
      }
    } finally {
      setDraftSaving(false);
    }
  }

  // Debounced autosave when draft has content.
  useEffect(() => {
    if (!open || busy || draftSaving) return;
    const hasContent = offlineDraftHasContent({
      workPlanDraft: draft,
      draft: null,
      attachmentNames: [],
    });
    if (!hasContent) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraftLocal({ quiet: true });
    }, 2500);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // Intentionally depend on draft; saveDraftLocal closes over latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on content changes only
  }, [open, busy, draft, localDraftId]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (quietAutosaveClearRef.current) clearTimeout(quietAutosaveClearRef.current);
    };
  }, []);

  useEffect(() => {
    if (!orgPath?.seats?.length) return;
    const keep = new Set(orgPath.seats.map((seat) => seat.sequenceLevel));
    setDraft((current) => {
      if (current.approvalLevels.length === 0) {
        return {
          ...current,
          approvalLevels: buildWorkPlanApprovalLevelsFromSeats(orgPath.seats),
        };
      }
      const next = current.approvalLevels.filter((level) => keep.has(level.level));
      if (next.length === current.approvalLevels.length) return current;
      return { ...current, approvalLevels: next };
    });
  }, [orgPath]);

  async function submit() {
    // Ensure seat structure exists before validate when org path loaded but levels empty.
    let draftToValidate = draft;
    if (draft.approvalLevels.length === 0 && orgPath?.seats?.length) {
      draftToValidate = {
        ...draft,
        approvalLevels: buildWorkPlanApprovalLevelsFromSeats(orgPath.seats),
      };
      setDraft(draftToValidate);
    } else if (draft.approvalLevels.length === 0) {
      draftToValidate = {
        ...draft,
        approvalLevels: [{ level: 1, agentId: "", optional: false }],
      };
      setDraft(draftToValidate);
    }

    const validationError = validateWorkPlanDraft(draftToValidate);
    if (validationError) {
      setError(validationError);
      const incomplete = firstIncompleteStepId();
      if (incomplete) setWizardStepId(incomplete);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const orderRequest = deriveWorkPlanOrderRequest(draftToValidate.workPlan);
      const form = new FormData();
      form.set("title", (effectiveMainTask.trim().replace(/\s+/g, " ").toUpperCase() || "TRAVEL ORDER"));
      form.set("mainTask", effectiveMainTask.trim());
      form.set("orderRequest", orderRequest);
      form.set("workPlanJson", JSON.stringify(draftToValidate.workPlan));
      form.set(
        "approvalLevels",
        JSON.stringify(levelsWithLabels(draftToValidate.approvalLevels, orgPath?.seats)),
      );
      if (draftToValidate.confirmationByAgentId.trim()) {
        form.set("confirmationByAgentId", draftToValidate.confirmationByAgentId.trim());
      }
      if (scopedCompanyTeamId) form.set("scopedCompanyTeamId", scopedCompanyTeamId);

      const payloadEntries: Record<string, string> = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") payloadEntries[k] = v;
      }

      async function queueOfflineCreate() {
        await queueFieldAssignmentCreate({
          draftRow: {
            localId: localDraftId,
            mainTaskName: effectiveMainTask,
            scopedCompanyTeamId: scopedCompanyTeamId ?? null,
            companyScopeAgentId,
            workPlanDraft: draftToValidate,
            draft: null,
            attachmentNames: [],
            syncStatus: "pending",
          },
          payload: payloadEntries,
          attachments: [],
        });
        setQueuedOffline(true);
        onCreated({ kpiId: localDraftId, offlineQueued: true });
        onClose();
      }

      if (!isBrowserOnline()) {
        await queueOfflineCreate();
        return;
      }

      try {
        // Cold Next.js compile of this route can exceed 8s in dev; match list-fetch budgets.
        const res = await fetchTravelOrderWithTimeout(
          "/api/kpi-maintenance/field-assignment",
          { method: "POST", body: form },
          45_000,
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          kpi?: { id?: string };
          travelOrder?: { id?: string };
        };
        if (!res.ok) {
          setError(body.error ?? "Could not create the travel order.");
          return;
        }
        const kpiId = body.kpi?.id;
        if (!kpiId) {
          setError("Travel order was created but the task id was missing.");
          return;
        }
        void deleteOfflineDraft(localDraftId).catch(() => undefined);
        onCreated({ kpiId, travelOrderId: body.travelOrder?.id ?? null });
        onClose();
      } catch (err) {
        if (isTravelOrderNetworkFailure(err)) {
          await queueOfflineCreate();
          return;
        }
        throw err;
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the travel order. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function applyOrgChartRecommendations() {
    if (!orgPath?.seats?.length && !orgPath?.recommendedConfirmation?.agentId) return;
    const levels = orgPath.seats?.length
      ? buildWorkPlanApprovalLevelsFromSeats(orgPath.seats)
      : [];
    const confirmerId = orgPath.recommendedConfirmation?.agentId?.trim() || "";
    setDraft((prev) => ({
      ...prev,
      approvalLevels: levels.length > 0 ? levels : prev.approvalLevels,
      confirmationByAgentId: confirmerId || prev.confirmationByAgentId,
    }));
    setError(null);
  }

  function updateApprovalLevel(level: number, agentId: string) {
    setDraft((prev) => ({
      ...prev,
      approvalLevels: prev.approvalLevels.map((lvl) =>
        lvl.level === level ? { ...lvl, agentId } : lvl,
      ),
    }));
  }

  function requestClose() {
    if (
      offlineDraftHasContent({
        workPlanDraft: draft,
        draft: null,
        attachmentNames: [],
      })
    ) {
      setConfirmDiscardDraft(true);
      return;
    }
    onClose();
  }

  const titleTruncated =
    effectiveMainTask.length > 72 ? `${effectiveMainTask.slice(0, 72)}…` : effectiveMainTask;

  return (
    <TaskBoardPopup
      open={open}
      onClose={requestClose}
      title="Travel Order for Management Approval"
      size="xl"
    >
      {!online ? <TravelOrderOfflineBanner /> : null}
      {queuedOffline ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          Travel Order saved offline and queued for sync.
        </p>
      ) : null}
      {draftNotice ? (
        <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-950 dark:text-emerald-100">
          {draftNotice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="sticky top-0 z-10 -mx-1 space-y-2 border-b border-zinc-200 bg-white/95 px-1 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {titleTruncated}
              </p>
              <span className="inline-flex shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                Draft
              </span>
            </div>
            {periodVenueShort ? (
              <p className="truncate text-xs text-zinc-500">{periodVenueShort}</p>
            ) : null}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              <span>
                Step {wizardIndex + 1} of {WORK_PLAN_WIZARD_STEPS.length}
              </span>
              <span>Personnel {personnelCount}</span>
              <span>Budget ₱{formatWorkPlanAmount(budgetTotal) || "0.00"}</span>
              <span>
                Approvers {approversFilled} of {approversTotal}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || draftSaving}
            title="Save this travel order locally and finish it later"
            onClick={() => void saveDraftLocal()}
          >
            {draftSaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Save draft
          </Button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-orange-600 transition-[width]"
            style={{ width: `${wizardProgress}%` }}
          />
        </div>
        <WorkPlanSectionChecklist
          completeById={completeById}
          activeId={wizardStep.id}
          onSelect={goToStep}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-300">
          {wizardStep.title}
        </h3>

        {wizardStep.id === "general" ||
        wizardStep.id === "details" ||
        wizardStep.id === "people" ||
        wizardStep.id === "budget" ||
        wizardStep.id === "justification" ||
        wizardStep.id === "results" ? (
          <WorkPlanFormFields
            meta={draft.workPlan}
            agents={allAgents}
            disabled={busy}
            sectionId={wizardStep.id}
            onChange={(workPlan) => setDraft((prev) => ({ ...prev, workPlan }))}
          />
        ) : null}

        {wizardStep.id === "approval" ? (
          <div className="space-y-3">
            <WorkPlanApprovalRecommendationGuide
              seats={orgPath?.seats ?? []}
              requestorOrgLayer={orgPath?.requestorOrgLayer ?? null}
              confirmation={
                orgPath?.recommendedConfirmation?.agentId?.trim() ||
                orgPath?.recommendedConfirmation?.agentName?.trim()
                  ? orgPath.recommendedConfirmation
                  : null
              }
              loading={orgPathLoading}
              error={orgPathError}
              disabled={busy}
              usedFallback={orgPath?.usedFallback ?? true}
              onApply={applyOrgChartRecommendations}
            />
            {approvalLevels.map((lvl) => {
              const label = "Approved by";
              const excluded = draft.approvalLevels
                .filter((other) => other.level !== lvl.level && other.agentId.trim())
                .map((other) => other.agentId.trim());
              return (
                <CompanyUserSearchField
                  key={`wp-appr-${lvl.level}`}
                  label={label}
                  users={approvalAgents}
                  value={lvl.agentId}
                  disabled={busy}
                  required={!lvl.optional}
                  excludedIds={excluded}
                  selectedFooter="subtitle"
                  onChange={(agentId) => updateApprovalLevel(lvl.level, agentId)}
                />
              );
            })}
            <CompanyUserSearchField
              label="To be Confirmed by"
              users={approvalAgents}
              value={draft.confirmationByAgentId}
              disabled={busy}
              required
              selectedFooter="subtitle"
              onChange={(agentId) =>
                setDraft((prev) => ({ ...prev, confirmationByAgentId: agentId }))
              }
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Approvals are sequential along the org chart from your manager up. The top of
              the chart is excluded. After every approver signs, the confirmer closes the
              travel order. You can override any recommended seat.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
          Cancel
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || isFirstStep} onClick={goBack}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Back
          </Button>
          {isLastStep ? (
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit for approval
            </Button>
          ) : (
            <Button type="button" disabled={busy} onClick={goNext}>
              Next
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {confirmDiscardDraft ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Discard this draft?
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Unsaved changes will be lost unless you save a draft first.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDiscardDraft(false)}>
                Keep editing
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmDiscardDraft(false);
                  onClose();
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </TaskBoardPopup>
  );
}
