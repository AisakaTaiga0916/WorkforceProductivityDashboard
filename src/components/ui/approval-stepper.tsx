"use client";

import { useId, useState } from "react";
import { Check, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Shared approval-step contract (Option D). Domain modules map their seats/levels into this. */
export type ApprovalStepState = "done" | "current" | "upcoming" | "returned";

export type ApprovalStep = {
  id: string;
  label: string;
  state: ApprovalStepState;
  /** Display name of the person who owns (current) or decided (done/returned) this step. */
  actorName?: string | null;
  /** ISO timestamp when the step was decided. */
  decidedAt?: string | null;
};

/** Server-computed payload for the shared approval chrome. */
export type ApprovalUi = {
  steps: ApprovalStep[];
  canAct: boolean;
};

export type ApprovalStepperProps = {
  steps: ApprovalStep[];
  /** Permission ∧ eligibility — computed by the server, never in the chrome. */
  canAct: boolean;
  busy?: boolean;
  /** Compact layout for narrow panels: hides sublabels, smaller comment box. */
  compact?: boolean;
  approveLabel?: string;
  returnLabel?: string;
  /** When true, Return stays disabled until a comment is entered. */
  requireCommentOnReturn?: boolean;
  /** Shown instead of the "Waiting on …" hint when !canAct (e.g. blocked prerequisites). */
  blockedHint?: string | null;
  onApprove?: (comment?: string) => void | Promise<void>;
  /** When omitted, the Return button is hidden. */
  onReturn?: (comment?: string) => void | Promise<void>;
  className?: string;
};

export function findCurrentApprovalStep(steps: ApprovalStep[]): ApprovalStep | undefined {
  return steps.find((step) => step.state === "current");
}

function formatDecidedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StepBadge({ index, state }: { index: number; state: ApprovalStepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
        state === "done" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        state === "current" && "bg-orange-600 text-white",
        state === "upcoming" && "border border-border bg-surface-muted text-muted",
        state === "returned" && "bg-rose-500/15 text-rose-700 dark:text-rose-300",
      )}
    >
      {state === "done" ? (
        <Check className="size-3" strokeWidth={3} />
      ) : state === "returned" ? (
        <Undo2 className="size-3" strokeWidth={3} />
      ) : (
        index + 1
      )}
    </span>
  );
}

function stepSublabel(step: ApprovalStep): string | null {
  if (step.state === "done" || step.state === "returned") {
    const decided = step.decidedAt ? formatDecidedAt(step.decidedAt) : null;
    return [step.actorName, decided].filter(Boolean).join(" · ") || null;
  }
  if (step.state === "current") return step.actorName ?? null;
  return null;
}

/**
 * Shared approval chrome: a step rail plus an Approve/Return strip.
 * Display + callbacks only — no workflow rules live here.
 */
export function ApprovalStepper({
  steps,
  canAct,
  busy = false,
  compact = false,
  approveLabel = "Approve",
  returnLabel = "Return",
  requireCommentOnReturn = false,
  blockedHint = null,
  onApprove,
  onReturn,
  className,
}: ApprovalStepperProps) {
  const [comment, setComment] = useState("");
  const commentId = useId();

  if (steps.length === 0) return null;

  const current = findCurrentApprovalStep(steps);
  const showActions = canAct && Boolean(current) && Boolean(onApprove);
  const returnNeedsComment = requireCommentOnReturn && !comment.trim();

  const submit = async (handler: (comment?: string) => void | Promise<void>) => {
    const trimmed = comment.trim();
    await handler(trimmed ? trimmed : undefined);
    setComment("");
  };

  return (
    <section
      className={cn("space-y-3", className)}
      aria-label="Approval progress"
    >
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {steps.map((step, index) => {
          const sublabel = stepSublabel(step);
          return (
            <li
              key={step.id}
              className="flex items-center gap-2"
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <StepBadge index={index} state={step.state} />
              <span className="flex flex-col">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    step.state === "upcoming" ? "text-muted" : "text-foreground",
                    step.state === "current" && "text-orange-700 dark:text-orange-300",
                  )}
                >
                  {step.label}
                  {step.state === "current" && <span className="sr-only"> (current step)</span>}
                  {step.state === "returned" && <span className="sr-only"> (returned)</span>}
                </span>
                {!compact && sublabel && (
                  <span className="text-[10px] text-muted">
                    <time dateTime={step.decidedAt ?? undefined} suppressHydrationWarning>
                      {sublabel}
                    </time>
                  </span>
                )}
              </span>
              {index < steps.length - 1 && (
                <span aria-hidden className="hidden h-px w-4 bg-border sm:block" />
              )}
            </li>
          );
        })}
      </ol>

      {!canAct && (blockedHint || (current && current.actorName)) && (
        <p className="text-[11px] text-muted">
          {blockedHint ? (
            <span className="font-medium text-amber-700 dark:text-amber-300">{blockedHint}</span>
          ) : (
            <>
              Waiting on{" "}
              <span className="font-semibold text-foreground">{current?.actorName}</span>.
            </>
          )}
        </p>
      )}

      {showActions && current && (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="sr-only" htmlFor={commentId}>
            Comment
          </label>
          <Textarea
            id={commentId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={compact ? 1 : 2}
            disabled={busy}
            placeholder={requireCommentOnReturn ? "Comment (required to return)" : "Comment (optional)"}
            className={cn("min-h-0", compact && "text-xs")}
          />
          <div className="flex items-center justify-end gap-2">
            {onReturn && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || returnNeedsComment}
                onClick={() => void submit(onReturn)}
              >
                {returnLabel}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (onApprove) void submit(onApprove);
              }}
            >
              {busy && <Loader2 className="mr-1 size-3 animate-spin" />}
              {busy ? "Working…" : approveLabel}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
