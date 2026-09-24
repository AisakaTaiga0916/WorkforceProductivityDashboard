"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

export type AssigneeSearchAgent = {
  id: string;
  name: string;
  email?: string | null;
  assignmentCompany?: { id?: string | null; name?: string | null } | null;
  team?: { id?: string | null; name?: string | null } | null;
  isOnDuty?: boolean;
  dutyStatus?: "ON_DUTY" | "OFFLINE";
  profileImage?: string | null;
  profileImageZoom?: number | null;
  profileImagePosX?: number | null;
  profileImagePosY?: number | null;
};

function agentOnDuty(a: AssigneeSearchAgent): boolean {
  if (typeof a.isOnDuty === "boolean") return a.isOnDuty;
  return a.dutyStatus === "ON_DUTY";
}

function agentCompanyLabel(a: AssigneeSearchAgent): string {
  return a.assignmentCompany?.name?.trim() || a.team?.name?.trim() || "No assigned company";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/** Circular assignee avatar: profile photo when set, initials circle otherwise. */
export function AssigneeAvatar({
  agent,
  className,
}: {
  agent: Pick<
    AssigneeSearchAgent,
    "name" | "profileImage" | "profileImageZoom" | "profileImagePosX" | "profileImagePosY"
  >;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = agent.profileImage?.trim() || null;

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (src && !imgFailed) {
    return (
      <div
        className={cn(
          "shrink-0 overflow-hidden rounded-full bg-zinc-200 ring-1 ring-inset ring-black/15 dark:bg-zinc-800 dark:ring-white/15",
          // Default 24px avatar; a caller-supplied className (size-4/size-5) overrides it.
          className ?? "size-6",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={agent.name}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
          style={{
            objectPosition: `${agent.profileImagePosX ?? 50}% ${agent.profileImagePosY ?? 50}%`,
            transform: `scale(${agent.profileImageZoom ?? 1})`,
            transformOrigin: "center",
          }}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-300 ring-1 ring-inset ring-black/15 dark:ring-white/15",
        className ?? "size-6",
      )}
    >
      {initialsFromName(agent.name)}
    </div>
  );
}

/**
 * Search-bar assignee picker: type to filter personnel, pick from the list.
 * Replaces the old per-card / per-subtask assignee dropdowns.
 */
export function AgentAssigneeSearch({
  value,
  agents,
  onSelect,
  disabled = false,
  placeholder = "Assign…",
  allowClear = false,
  align = "left",
  autoFocus = false,
  inputClassName,
  emptyHint,
  selectedLabel,
}: {
  /** Currently selected agent id ("" = unassigned). */
  value: string;
  agents: AssigneeSearchAgent[];
  onSelect: (agentId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  align?: "left" | "right";
  /** Focus the search input when it mounts (inline edit-in-place pickers). */
  autoFocus?: boolean;
  /** Extra classes merged onto the search input (e.g. underline-style inline edit). */
  inputClassName?: string;
  /** Shown when the roster is empty (e.g. pick a company/department first). */
  emptyHint?: string | null;
  /** Fallback label when `value` is set but the agent is not in `agents`. */
  selectedLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = agents.find((a) => a.id === value) ?? null;
  const closedLabel = selected?.name ?? (value ? selectedLabel?.trim() || "" : "");

  function closeList() {
    setOpen(false);
    setQuery("");
  }

  /**
   * Position the dropdown relative to the input. Rendered via a portal to
   * document.body so cards with overflow-hidden never clip the list.
   * Prefer opening BELOW the input so scope controls above the search stay clickable.
   */
  const computeListPos = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const LIST_W = 288; // w-72
    const GAP = 4;
    const EDGE = 8;
    const MAX_H = 256; // max-h-64
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - GAP - EDGE);
    const spaceAbove = Math.max(0, rect.top - GAP - EDGE);
    // Prefer below unless there is almost no room (keeps Company/Department scope usable).
    const openBelow = spaceBelow >= 96 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(MAX_H, openBelow ? spaceBelow : spaceAbove));
    const rawLeft = align === "right" ? rect.right - LIST_W : rect.left;
    const left = Math.max(EDGE, Math.min(rawLeft, window.innerWidth - LIST_W - EDGE));
    const top = openBelow
      ? rect.bottom + GAP
      : Math.max(EDGE, rect.top - GAP - maxHeight);
    const width = Math.min(LIST_W, window.innerWidth - left - EDGE);
    setPos((prev) =>
      prev &&
      Math.abs(prev.top - top) < 0.5 &&
      Math.abs(prev.left - left) < 0.5 &&
      Math.abs(prev.width - width) < 0.5 &&
      Math.abs(prev.maxHeight - maxHeight) < 0.5
        ? prev
        : { top, left, width, maxHeight },
    );
  }, [align]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    computeListPos();
    function onScroll(e: Event) {
      const target = e.target;
      // Keep list open while scrolling inside it; close on board/page scroll so it
      // cannot cover Company/Department scope controls after the card moves.
      if (target instanceof Node && listboxRef.current?.contains(target)) {
        computeListPos();
        return;
      }
      closeList();
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", computeListPos);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", computeListPos);
    };
  }, [open, computeListPos]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node | null;
      // Keep the dropdown open when the click lands on the input or the portaled listbox.
      if (rootRef.current?.contains(target)) return;
      if (listboxRef.current?.contains(target)) return;
      closeList();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? agents.filter((a) =>
          [a.name, a.email ?? "", agentCompanyLabel(a)].some((field) => field.toLowerCase().includes(q)),
        )
      : agents;
    return [...list].sort((a, b) => {
      const dutyA = agentOnDuty(a);
      const dutyB = agentOnDuty(b);
      if (dutyA !== dutyB) return dutyA ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, query]);

  // Re-run positioning once the listbox has rendered so the flip decision uses its
  // real height (and when filtering changes the list length).
  useLayoutEffect(() => {
    if (open) computeListPos();
  }, [open, computeListPos, filtered.length]);

  const hasUnassign = allowClear && (query.trim() === "" || "unassign".includes(query.trim().toLowerCase()));
  const rowCount = filtered.length + (hasUnassign ? 1 : 0);

  function commit(index: number) {
    if (hasUnassign) {
      if (index === 0) {
        onSelect("");
        closeList();
        return;
      }
      index -= 1;
    }
    const agent = filtered[index];
    if (agent) {
      onSelect(agent.id);
      closeList();
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="relative">
        {/* The selected assignee avatar is rendered in the task's Assignee line,
            not inside the search bar, so the bar stays a plain search control. */}
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-label="Assignee search"
          value={open ? query : closedLabel}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
            // Clear closed-label display so typing starts a real search (not a fake match).
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(rowCount - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open) commit(highlight);
              else setOpen(true);
            } else if (e.key === "Escape") {
              closeList();
            }
          }}
          className={cn(
            "w-full min-w-0 pl-7 text-[11px] font-semibold text-zinc-900 outline-none transition focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-100",
            // Boxed look by default; when a custom style is supplied (e.g. the inline
            // underline edit on the task board) it fully replaces the boxed look so
            // there are no conflicting utilities fighting in the generated CSS.
            inputClassName ? "" : "rounded-md border border-zinc-300 bg-white py-1 pr-2 dark:border-zinc-700 dark:bg-zinc-900",
            inputClassName,
          )}
        />
      </div>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              id={listboxId}
              ref={listboxRef}
              role="listbox"
              className="fixed z-[400] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              style={{
                top: pos.top,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
            >
          {hasUnassign ? (
            <button
              type="button"
              role="option"
              aria-selected={highlight === 0}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(0);
              }}
              onMouseEnter={() => setHighlight(0)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-zinc-700 dark:text-zinc-300",
                highlight === 0 && "bg-orange-50 dark:bg-orange-950/40",
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" aria-hidden>
                <UserRound className="size-3.5" />
              </span>
              <span className="flex-1">Unassigned</span>
              {value === "" ? <Check className="size-3.5 text-orange-600" aria-hidden /> : null}
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {agents.length === 0
                ? emptyHint?.trim() || "No personnel in this scope."
                : query.trim()
                  ? `No personnel match “${query.trim()}”.`
                  : "No personnel available."}
            </p>
          ) : (
            filtered.map((agent, i) => {
              const rowIndex = i + (hasUnassign ? 1 : 0);
              const active = highlight === rowIndex;
              const onDuty = agentOnDuty(agent);
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(rowIndex);
                  }}
                  onMouseEnter={() => setHighlight(rowIndex)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    active && "bg-orange-50 dark:bg-orange-950/40",
                    !onDuty && "opacity-60",
                  )}
                >
                  <AssigneeAvatar agent={agent} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                      {agent.name}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                      {agentCompanyLabel(agent)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                      onDuty
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                    )}
                  >
                    {onDuty ? "On Duty" : "Offline"}
                  </span>
                  {agent.id === value ? <Check className="size-3.5 shrink-0 text-orange-600" aria-hidden /> : null}
                </button>
              );
            })
          )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
