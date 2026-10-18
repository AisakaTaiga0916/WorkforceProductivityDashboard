"use client";

import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  MapPin,
  Ticket,
  UserRound,
  Zap,
} from "lucide-react";
import type { GlobalSearchResult } from "@/lib/global-search";
import { requestTypeAcronym } from "@/modules/requests/request-types";
import { cn } from "@/lib/cn";
import { SearchHighlight } from "@/components/global-search/SearchHighlight";

function iconForKind(kind: GlobalSearchResult["kind"], href?: string) {
  if (kind === "recent") {
    if (href?.includes("/agent/tasks") || href?.includes("task")) return ClipboardList;
    if (href?.includes("travel")) return MapPin;
    if (href?.includes("workforce") || href?.includes("personnel")) return UserRound;
    return Ticket;
  }
  switch (kind) {
    case "ticket":
      return Ticket;
    case "task":
      return ClipboardList;
    case "travel_order":
      return MapPin;
    case "project":
      return Briefcase;
    case "user":
      return UserRound;
    case "action":
    default:
      return Zap;
  }
}

export function SearchResultRow({
  item,
  query,
  compact = false,
  selected = false,
  asDiv = false,
  onSelect,
}: {
  item: GlobalSearchResult;
  query: string;
  compact?: boolean;
  selected?: boolean;
  /** Avoid nested buttons when rendered inside cmdk CommandItem */
  asDiv?: boolean;
  onSelect: (item: GlobalSearchResult) => void;
}) {
  const Icon = iconForKind(item.kind, item.href);
  const badge =
    item.badge ??
    (item.requestType ? requestTypeAcronym(item.requestType) : item.kind === "recent" ? "TICKET" : item.kind.toUpperCase());

  const className = cn(
    "flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition",
    selected
      ? "bg-orange-50 dark:bg-orange-950/40"
      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70",
  );

  const content = (
    <>
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span
          className={cn(
            "block truncate font-medium text-zinc-900 dark:text-zinc-100",
            compact ? "text-xs" : "text-sm",
          )}
          title={item.title}
        >
          <SearchHighlight text={item.title} query={query} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {badge}
          </span>
          {item.status ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/50 dark:text-sky-200">
              {item.status}
            </span>
          ) : null}
        </span>
        {item.subtitle ? (
          <span
            className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400"
            title={item.subtitle}
          >
            <SearchHighlight text={item.subtitle} query={query} />
          </span>
        ) : null}
      </span>
      <ArrowRight className="mt-1.5 size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
    </>
  );

  if (asDiv) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(item)}
      className={className}
    >
      {content}
    </button>
  );
}
