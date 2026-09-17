"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type CompanyUserOption = {
  id: string;
  name: string;
  email?: string | null;
  /** Optional department / role line under the name. */
  subtitle?: string | null;
  /** Optional group heading in the dropdown (e.g. major department). */
  group?: string | null;
  /** Stable list key when the same agent appears under multiple sections. */
  optionKey?: string | null;
};

type CompanyUserSearchFieldProps = {
  label: string;
  users: CompanyUserOption[];
  value: string;
  onChange: (agentId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  /** Agent ids that must not be selectable (e.g. prior approvers on this request). */
  excludedIds?: ReadonlySet<string> | string[];
  emptyMessage?: string;
  /** Bottom caption under a closed selection. Default keeps name + email. */
  selectedFooter?: "default" | "subtitle";
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function optionKeyOf(u: CompanyUserOption): string {
  return (u.optionKey ?? u.id).trim() || u.id;
}

export function CompanyUserSearchField({
  label,
  users,
  value,
  onChange,
  disabled = false,
  placeholder = "Search company users…",
  required = false,
  excludedIds,
  emptyMessage = "No matching users.",
  selectedFooter = "default",
}: CompanyUserSearchFieldProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevValueRef = useRef(value);

  const excluded = useMemo(() => {
    if (!excludedIds) return new Set<string>();
    return excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  }, [excludedIds]);

  const selected = useMemo(() => {
    const fromList = users.find((u) => u.id === value) ?? null;
    if (fromList) return fromList;
    if (value && query.trim()) {
      return { id: value, name: query.trim() };
    }
    return null;
  }, [users, value, query]);

  const selectable = useMemo(
    () => users.filter((u) => !excluded.has(u.id) || u.id === value),
    [users, excluded, value],
  );

  const filtered = useMemo(() => {
    const q = normalize(query);
    const matched = !q
      ? selectable
      : selectable.filter((u) => {
          const hay = `${u.name} ${u.email ?? ""} ${u.subtitle ?? ""} ${u.group ?? ""}`;
          return normalize(hay).includes(q);
        });
    return matched.slice(0, 60);
  }, [selectable, query]);

  const grouped = useMemo(() => {
    const hasGroups = filtered.some((u) => Boolean(u.group?.trim()));
    if (!hasGroups) return [{ group: null as string | null, users: filtered }];

    const map = new Map<string, CompanyUserOption[]>();
    for (const u of filtered) {
      const g = u.group?.trim() || "Other";
      const list = map.get(g) ?? [];
      list.push(u);
      map.set(g, list);
    }
    return [...map.entries()].map(([group, groupUsers]) => ({ group, users: groupUsers }));
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (selected) {
      setQuery(selected.name);
    } else if (!value) {
      setQuery("");
    }
  }, [selected, value]);

  useEffect(() => {
    if (value && value !== prevValueRef.current) {
      setOpen(false);
    }
    prevValueRef.current = value;
  }, [value]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative block w-full min-w-0 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400",
        open && "z-40",
      )}
    >
      {label}
      <div className="relative mt-1 w-full min-w-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          required={required && !value}
          aria-required={required || undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-9 text-sm font-normal text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {value ? (
          <button
            type="button"
            disabled={disabled}
            aria-label="Clear selection"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
            className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}

        {open && !disabled ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs font-normal text-zinc-500">{emptyMessage}</p>
            ) : (
              grouped.map(({ group, users: groupUsers }) => (
                <div key={group ?? "__all"}>
                  {group ? (
                    <p className="sticky top-0 z-[1] border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                      {group}
                    </p>
                  ) : null}
                  {groupUsers.map((u) => (
                    <button
                      key={optionKeyOf(u)}
                      type="button"
                      onClick={() => {
                        onChange(u.id);
                        setQuery(u.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full flex-col items-start border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 hover:bg-orange-50 dark:border-zinc-800 dark:hover:bg-orange-950/30",
                        u.id === value && "bg-orange-50 dark:bg-orange-950/40",
                      )}
                    >
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {u.name}
                      </span>
                      {u.subtitle ? (
                        <span className="text-[11px] font-medium text-orange-700/90 dark:text-orange-300/90">
                          {u.subtitle}
                        </span>
                      ) : null}
                      {u.email ? (
                        <span className="text-[11px] font-normal text-zinc-500">{u.email}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {selected && !open && (selectedFooter !== "subtitle" || Boolean(selected.subtitle?.trim())) ? (
        <p className="mt-1 truncate text-[11px] font-normal text-zinc-600 dark:text-zinc-400">
          {selectedFooter === "subtitle"
            ? selected.subtitle?.trim()
            : `Selected: ${selected.name}${
                selected.subtitle
                  ? ` · ${selected.subtitle}`
                  : selected.email
                    ? ` · ${selected.email}`
                    : ""
              }`}
        </p>
      ) : null}
    </div>
  );
}
