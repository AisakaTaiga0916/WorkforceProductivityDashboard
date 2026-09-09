"use client";

import { useEffect, useMemo, useState } from "react";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { IntakeApprovalRecommendationGuide } from "@/lib/intake-approval-recommendations";
import type { RequestTypeId } from "@/lib/request-types";

type Props = {
  requestType: RequestTypeId;
  requestorSectionId?: string;
  sendToSectionId?: string;
  requestingCompanyTeamId?: string;
  skipNotedBy?: boolean;
  skipApprovedBy?: boolean;
  deferBookkeeper?: boolean;
  /** ACA matrix inputs — required for AUTHORITY_TO_CONDUCT_ACTIVITY recommendations. */
  acaRecommendingLevel?: string;
  acaApprovingPath?: string;
  acaApprovingSeatCount?: number;
  onApply: (
    assignees: Record<string, string>,
    people: Array<{ key: string; id: string; name: string }>,
  ) => void;
};

export function IntakeApprovalRecommendationGuide({
  requestType,
  requestorSectionId = "",
  sendToSectionId = "",
  requestingCompanyTeamId = "",
  skipNotedBy = false,
  skipApprovedBy = false,
  deferBookkeeper = false,
  acaRecommendingLevel = "",
  acaApprovingPath = "",
  acaApprovingSeatCount = 0,
  onApply,
}: Props) {
  const [guide, setGuide] = useState<IntakeApprovalRecommendationGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () =>
      [
        requestType,
        requestorSectionId.trim(),
        sendToSectionId.trim(),
        requestingCompanyTeamId.trim(),
        skipNotedBy ? "1" : "0",
        skipApprovedBy ? "1" : "0",
        deferBookkeeper ? "1" : "0",
        acaRecommendingLevel.trim(),
        acaApprovingPath.trim(),
        String(acaApprovingSeatCount || 0),
      ].join("|"),
    [
      requestType,
      requestorSectionId,
      sendToSectionId,
      requestingCompanyTeamId,
      skipNotedBy,
      skipApprovedBy,
      deferBookkeeper,
      acaRecommendingLevel,
      acaApprovingPath,
      acaApprovingSeatCount,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (
          requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY" &&
          (!acaRecommendingLevel.trim() || !acaApprovingPath.trim() || acaApprovingSeatCount < 1)
        ) {
          if (!cancelled) {
            setGuide(null);
            setLoading(false);
          }
          return;
        }

        const params = new URLSearchParams({ requestType });
        const requestorId = requestorSectionId.trim();
        const sendToId = sendToSectionId.trim();
        if (requestorId) params.set("requestorSectionId", requestorId);
        if (sendToId) params.set("sendToSectionId", sendToId);
        const requestingCompanyId = requestingCompanyTeamId.trim();
        if (requestingCompanyId) params.set("requestingCompanyTeamId", requestingCompanyId);
        if (skipNotedBy) params.set("skipNotedBy", "1");
        if (skipApprovedBy) params.set("skipApprovedBy", "1");
        if (deferBookkeeper) params.set("deferBookkeeper", "1");
        if (acaRecommendingLevel.trim()) {
          params.set("acaRecommendingLevel", acaRecommendingLevel.trim());
        }
        if (acaApprovingPath.trim()) {
          params.set("acaApprovingPath", acaApprovingPath.trim());
        }
        if (acaApprovingSeatCount > 0) {
          params.set("acaApprovingSeatCount", String(acaApprovingSeatCount));
        }

        const res = await fetch(`/api/intake/approval-recommendations?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not load approval recommendations.");
        }
        const data = (await res.json()) as IntakeApprovalRecommendationGuide;
        if (!cancelled) setGuide(data);
      } catch (err) {
        if (!cancelled) {
          setGuide(null);
          setError(err instanceof Error ? err.message : "Could not load approval recommendations.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    queryKey,
    deferBookkeeper,
    requestType,
    requestorSectionId,
    requestingCompanyTeamId,
    sendToSectionId,
    skipApprovedBy,
    skipNotedBy,
    acaRecommendingLevel,
    acaApprovingPath,
    acaApprovingSeatCount,
  ]);

  const filledSeats = guide?.seats.filter((seat) => seat.agentId) ?? [];
  const canApply = filledSeats.length > 0;

  const sectionSummary = useMemo(() => {
    if (!guide) return null;
    const requestorIsSubsection =
      guide.requestorMainSectionName &&
      guide.requestorSectionName &&
      guide.requestorMainSectionName !== guide.requestorSectionName;

    if (requestType === "REQUEST_FOR_PAYMENT") {
      const parts: string[] = [];
      if (guide.requestorSectionName) {
        parts.push(`requesting department ${guide.requestorSectionName}`);
      }
      if (guide.requestorMainSectionName) {
        parts.push(
          requestorIsSubsection
            ? `main section ${guide.requestorMainSectionName} (sub-department head first)`
            : `main section ${guide.requestorMainSectionName}`,
        );
      }
      if (guide.sendToSectionName) {
        parts.push(`bookkeeper from send-to section ${guide.sendToSectionName}`);
      }
      if (guide.requestingCompanyName) {
        parts.push(`requesting company ${guide.requestingCompanyName}`);
      } else if (guide.requestorCompanyName) {
        parts.push(`requestor company ${guide.requestorCompanyName}`);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
      return guide.requestorCompanyName
        ? `company ${guide.requestorCompanyName} · authority matrix positions`
        : "authority matrix positions";
    }
    if (requestType === "ITEM_REQUISITION_SLIP") {
      return guide.requestorMainSectionName
        ? `Approved By from ${guide.requestorMainSectionName} (Canvassed By is set on the Assignment Board)`
        : "Approved By from your department (Canvassed By is set on the Assignment Board)";
    }
    if (requestType === "JOB_ORDER") {
      const parts: string[] = [];
      if (guide.requestorSectionName) {
        parts.push(`requestor head from ${guide.requestorSectionName}`);
      }
      if (guide.sendToSectionName) {
        parts.push(`send-to head from ${guide.sendToSectionName}`);
      }
      parts.push("HR Approver");
      return parts.join(" · ");
    }
    if (guide.requestorMainSectionName) {
      return requestorIsSubsection
        ? `main section ${guide.requestorMainSectionName} (sub-department head first for ${guide.requestorSectionName})`
        : `main section ${guide.requestorMainSectionName}`;
    }
    return null;
  }, [guide, requestType]);

  const helpText = useMemo(() => {
    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
      return "Suggested assignees from the authority matrix positions for your company and selected nature/cost. You can still choose someone else below.";
    }
    if (requestType === "ITEM_REQUISITION_SLIP") {
      return "Suggested Approved By from your department. Canvassed By is assigned later on the Assignment Board. You can still choose someone else below.";
    }
    if (requestType === "REQUEST_FOR_PAYMENT") {
      return "Suggested assignees from org-chart sections. You can pick any company user for each seat below.";
    }
    if (requestType === "JOB_ORDER") {
      return "Suggested chain: head of your department → head of the send-to department → HR Approver. The form seat is Approved By. You can pick any company user for each seat below.";
    }
    return "Suggested assignees from org-chart sections and position holders. You can pick any company user for each seat below.";
  }, [requestType]);

  function handleApply() {
    if (!guide) return;
    const next: Record<string, string> = {};
    const people: Array<{ key: string; id: string; name: string }> = [];
    for (const seat of guide.seats) {
      const id = seat.agentId?.trim() ?? "";
      const name = seat.agentName?.trim() ?? "";
      if (!id) continue;
      next[seat.key] = id;
      people.push({ key: seat.key, id, name: name || id });
    }
    if (Object.keys(next).length === 0) return;
    onApply(next, people);
  }

  const emptyHint =
    requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY"
      ? "Select Nature of Request and Estimated Cost to see recommended approvers."
      : requestType === "JOB_ORDER"
        ? "Select your department and Send request to (department) to see recommended approvers."
        : "Select your department to see recommended approvers.";

  return (
    <div className="rounded-xl border border-orange-200/80 bg-orange-50/40 p-3 dark:border-orange-500/25 dark:bg-orange-950/15 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Lightbulb className="size-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
            Approval recommendations
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {helpText}
            {sectionSummary ? ` — ${sectionSummary}.` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canApply || loading}
          onClick={handleApply}
          className="shrink-0 border-orange-300 bg-white text-orange-900 hover:bg-orange-50 dark:border-orange-500/40 dark:bg-zinc-950 dark:text-orange-100 dark:hover:bg-orange-950/40"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3.5" aria-hidden />
          )}
          Apply recommendations
        </Button>
      </div>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading recommendations…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>
      ) : guide && guide.seats.length > 0 ? (
        <div
          className={cn(
            "mt-3 grid gap-2",
            guide.seats.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
          {guide.seats.map((seat) => (
            <div
              key={seat.key}
              className={cn(
                "rounded-lg border px-3 py-2",
                seat.agentId
                  ? "border-emerald-200/80 bg-white dark:border-emerald-500/25 dark:bg-zinc-950/50"
                  : "border-zinc-200/80 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/30",
              )}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                {seat.label}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-sm font-medium",
                  seat.agentName
                    ? "text-emerald-800 dark:text-emerald-300"
                    : "text-zinc-400 dark:text-zinc-600",
                )}
              >
                {seat.agentName ?? "No recommendation yet"}
              </p>
              {seat.hint ? (
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{seat.hint}</p>
              ) : !seat.agentName ? (
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  No matching user found for this seat.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{emptyHint}</p>
      )}
    </div>
  );
}
