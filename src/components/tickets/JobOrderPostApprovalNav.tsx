"use client";

import { useEffect } from "react";
import { Handshake, Kanban, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  jobOrderSectionIdForKey,
  resolveJobOrderSectionFromHash,
  scrollToJobOrderSection,
  type JobOrderScrollSection,
} from "@/lib/job-order-section-ids";

type Props = {
  showTaskBoard?: boolean;
  showExecutionTeam?: boolean;
  showAssistanceTeam?: boolean;
  activeSection: JobOrderScrollSection | null;
  onSelectSection: (section: JobOrderScrollSection) => void;
  /** Compact row for Request controls header. */
  compact?: boolean;
};

const HASH_BY_SECTION: Record<JobOrderScrollSection, string> = {
  "task-board": "jo-task-board",
  "execution-team": "jo-execution-team",
  "assistance-team": "jo-assistance-team",
};

function selectSection(
  section: JobOrderScrollSection,
  onSelectSection: (section: JobOrderScrollSection) => void,
) {
  onSelectSection(section);
  if (typeof window !== "undefined") {
    const hash = HASH_BY_SECTION[section];
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${hash}`);
  }
}

export function JobOrderPostApprovalNav({
  showTaskBoard = true,
  showExecutionTeam = true,
  showAssistanceTeam = false,
  activeSection,
  onSelectSection,
  compact = false,
}: Props) {
  useEffect(() => {
    const section = resolveJobOrderSectionFromHash(window.location.hash);
    if (!section) return;
    if (section === "task-board" && !showTaskBoard) return;
    if (section === "execution-team" && !showExecutionTeam) return;
    if (section === "assistance-team" && !showAssistanceTeam) return;
    onSelectSection(section);
  }, [showTaskBoard, showExecutionTeam, showAssistanceTeam, onSelectSection]);

  useEffect(() => {
    if (!activeSection) return;
    const timer = window.setTimeout(() => {
      scrollToJobOrderSection(jobOrderSectionIdForKey(activeSection));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeSection]);

  if (!showTaskBoard && !showExecutionTeam && !showAssistanceTeam) return null;

  const btnClass =
    "inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition";

  return (
    <div className={compact ? "flex flex-wrap gap-2" : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 dark:border-emerald-500/25"}>
      {!compact ? (
        <p className="mb-2 text-xs text-emerald-900 dark:text-emerald-100">
          Execution workspace is open. Choose a section:
        </p>
      ) : null}
      <div className={compact ? "flex w-full flex-wrap gap-2" : "flex flex-wrap gap-2"}>
        {showTaskBoard ? (
          <button
            type="button"
            aria-pressed={activeSection === "task-board"}
            onClick={() => selectSection("task-board", onSelectSection)}
            className={cn(
              btnClass,
              activeSection === "task-board"
                ? "border-orange-500 bg-orange-500/25 text-orange-950 ring-2 ring-orange-400/60 dark:border-orange-400 dark:bg-orange-950/60 dark:text-orange-50"
                : "border-orange-400/50 bg-orange-500/10 text-orange-950 hover:bg-orange-500/20 dark:border-orange-500/40 dark:bg-orange-950/30 dark:text-orange-100 dark:hover:bg-orange-950/45",
            )}
          >
            <Kanban className="size-3.5 shrink-0" aria-hidden />
            Link Task Board task
          </button>
        ) : null}
        {showExecutionTeam ? (
          <button
            type="button"
            aria-pressed={activeSection === "execution-team"}
            onClick={() => selectSection("execution-team", onSelectSection)}
            className={cn(
              btnClass,
              activeSection === "execution-team"
                ? "border-emerald-500 bg-emerald-500/25 text-emerald-950 ring-2 ring-emerald-400/60 dark:border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-50"
                : "border-emerald-400/50 bg-emerald-500/10 text-emerald-950 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/45",
            )}
          >
            <Users className="size-3.5 shrink-0" aria-hidden />
            Execution team
          </button>
        ) : null}
        {showAssistanceTeam ? (
          <button
            type="button"
            aria-pressed={activeSection === "assistance-team"}
            onClick={() => selectSection("assistance-team", onSelectSection)}
            className={cn(
              btnClass,
              activeSection === "assistance-team"
                ? "border-sky-500 bg-sky-500/25 text-sky-950 ring-2 ring-sky-400/60 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-50"
                : "border-sky-400/50 bg-sky-500/10 text-sky-950 hover:bg-sky-500/20 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-100 dark:hover:bg-sky-950/45",
            )}
          >
            <Handshake className="size-3.5 shrink-0" aria-hidden />
            Seek Assistance
          </button>
        ) : null}
      </div>
    </div>
  );
}
