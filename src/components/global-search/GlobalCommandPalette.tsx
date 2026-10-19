"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckSquare,
  ClipboardList,
  FileText,
  Home,
  Loader2,
  MapPin,
  PlusSquare,
  Settings,
  Shield,
  Ticket,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { SearchHighlight } from "@/components/global-search/SearchHighlight";
import { SearchResultRow } from "@/components/global-search/SearchResultRow";
import { useDebouncedGlobalSearch } from "@/components/global-search/useDebouncedGlobalSearch";
import type { GlobalSearchResult, QuickAction } from "@/lib/global-search";
import { groupLabelForKind } from "@/lib/global-search";

const GROUP_ORDER = [
  "Recent",
  "Actions",
  "Tickets",
  "Tasks",
  "Travel Orders",
  "Projects",
  "Users",
] as const;

function iconForQuickAction(action: QuickAction): LucideIcon {
  const id = action.id.replace(/^nav-/, "");
  const href = action.href.toLowerCase();
  const label = action.label.toLowerCase();

  if (id === "home" || href === "/") return Home;
  if (id === "create" || id === "create-ticket" || label.includes("issue")) return Ticket;
  if (id === "create-rfp" || label.includes("payment")) return FileText;
  if (id === "create-job-order" || label.includes("job order")) return ClipboardList;
  if (id === "create-travel-order" || label.includes("travel")) return MapPin;
  if (id === "task-board" || href.includes("/work/tasks")) return CheckSquare;
  if (id === "my-assigned" || href === "/agent" || href.startsWith("/agent?")) return Ticket;
  if (id === "my-requests" || href.includes("my-requests")) return FileText;
  if (id === "assignment-board") return ClipboardList;
  if (id === "workforce") return Users;
  if (id === "kpi" || href.includes("insights")) return BarChart3;
  if (id === "process") return Settings;
  if (id.includes("superadmin") || id === "priority-alerts") {
    return Shield;
  }
  if (id === "account" || label.includes("account")) return UserCircle;
  if (label.includes("create") || label.includes("new")) return PlusSquare;
  if (action.subtitle?.toLowerCase() === "navigate") return Settings;
  return Ticket;
}

export function GlobalCommandPalette({
  open,
  initialQuery = "",
  onOpenChange,
  recentItems,
  quickActions,
  onNavigate,
  filterQuickActions,
}: {
  open: boolean;
  initialQuery?: string;
  onOpenChange: (open: boolean) => void;
  recentItems: GlobalSearchResult[];
  quickActions: QuickAction[];
  onNavigate: (item: GlobalSearchResult | QuickAction) => void;
  filterQuickActions: (actions: QuickAction[], query: string) => QuickAction[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const { loading, error, data, trimmed, hasQuery } = useDebouncedGlobalSearch(query, open, 10);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const filteredActions = useMemo(
    () => filterQuickActions(quickActions, query),
    [quickActions, query, filterQuickActions],
  );

  const groupedResults = useMemo(() => {
    const map = new Map<string, GlobalSearchResult[]>();
    for (const row of data?.results ?? []) {
      const label = groupLabelForKind(row.kind);
      const list = map.get(label) ?? [];
      list.push(row);
      map.set(label, list);
    }
    return map;
  }, [data?.results]);

  const showRecent = !hasQuery && recentItems.length > 0;
  const showActions = !hasQuery || filteredActions.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tickets, requests, users…"
        aria-label="Global search"
      />
      <CommandList className="command-scroll max-h-[min(420px,60vh)]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Searching…
          </div>
        ) : null}
        {!loading && error ? (
          <div className="px-3 py-6 text-center text-sm text-rose-600 dark:text-rose-300">
            {error}
          </div>
        ) : null}
        {!loading && !error && hasQuery && (data?.results.length ?? 0) === 0 ? (
          <CommandEmpty>No results for “{trimmed}”.</CommandEmpty>
        ) : null}

        {showRecent ? (
          <CommandGroup heading="Recent">
            {recentItems.map((item) => (
              <CommandItem
                key={`recent-${item.id}-${item.href}`}
                value={`recent ${item.title} ${item.subtitle ?? ""}`}
                onSelect={() => onNavigate(item)}
                className="p-0 data-[selected=true]:bg-transparent [&[data-selected=true]>div]:bg-orange-50 dark:[&[data-selected=true]>div]:bg-orange-950/40"
              >
                <SearchResultRow asDiv item={item} query={query} onSelect={onNavigate} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {showActions ? (
          <>
            {showRecent ? <CommandSeparator /> : null}
            <CommandGroup heading="Quick Actions">
              {filteredActions.map((action) => {
                const Icon = iconForQuickAction(action);
                return (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${action.subtitle ?? ""} ${(action.keywords ?? []).join(" ")}`}
                    onSelect={() => onNavigate(action)}
                    className="flex items-start gap-3 py-2.5"
                  >
                    <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-orange-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-orange-300">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        <SearchHighlight text={action.label} query={query} />
                      </span>
                      {action.subtitle ? (
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          <SearchHighlight text={action.subtitle} query={query} />
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        ) : null}

        {!loading && !error && hasQuery
          ? GROUP_ORDER.filter((label) => label !== "Recent" && label !== "Actions").map((label) => {
              const rows = groupedResults.get(label);
              if (!rows?.length) return null;
              return (
                <div key={label}>
                  <CommandSeparator />
                  <CommandGroup heading={label}>
                    {rows.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.kind} ${item.title} ${item.subtitle ?? ""} ${item.status ?? ""}`}
                        onSelect={() => onNavigate(item)}
                        className="p-0 data-[selected=true]:bg-transparent [&[data-selected=true]>div]:bg-orange-50 dark:[&[data-selected=true]>div]:bg-orange-950/40"
                      >
                        <SearchResultRow asDiv item={item} query={query} onSelect={onNavigate} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              );
            })
          : null}
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="min-w-0 truncate">Use ↑ ↓ to navigate · Enter to open · Esc to close</span>
        <CommandShortcut className="text-zinc-500 dark:text-zinc-400">Ctrl K</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
