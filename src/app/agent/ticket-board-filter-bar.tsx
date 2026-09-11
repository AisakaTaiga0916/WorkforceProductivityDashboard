"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import Filters, {
  Filter,
  FilterIcon,
  FilterOperator,
  FilterOption,
  FiltersTrigger,
  SavedFilter,
  loadSavedFilters,
  persistSavedFilters,
} from "@/components/ui/filters";

export type FilterField = {
  visible: boolean;
  value: string;
  options: Array<{ value: string; label: string }>;
};

type TicketBoardFilterBarProps = {
  initialQuery: string;
  placeholder: string;
  company: FilterField;
  section: FilterField;
  assigned: FilterField;
  priority: FilterField;
  requestType: FilterField;
  status: FilterField;
  /** Group Board: requestor company/department. */
  sentBy?: FilterField;
  /** Group Board: send-to company/department. */
  received?: FilterField;
  savedFilterStorageKey?: string;
};

type FieldId =
  | "company"
  | "section"
  | "assigned"
  | "priority"
  | "requestType"
  | "status"
  | "sentBy"
  | "received";

const FIELD_DEFS: Array<{ id: FieldId; type: string; param: string }> = [
  { id: "company", type: "Company", param: "company" },
  { id: "section", type: "Departments", param: "section" },
  { id: "sentBy", type: "Sent by", param: "sentBy" },
  { id: "received", type: "Received", param: "received" },
  { id: "assigned", type: "Assigned", param: "assigned" },
  { id: "priority", type: "Priority", param: "priority" },
  { id: "requestType", type: "Request type", param: "requestType" },
  { id: "status", type: "Status", param: "status" },
];

const HIDDEN_FIELD: FilterField = { visible: false, value: "ALL", options: [] };

/**
 * Search + filter bar for the Request Board. Active filters render as chips
 * (value combobox per chip) added via the FiltersTrigger button; every change
 * applies via client-side navigation (router.replace) instead of a full GET
 * reload. Chips display option labels while the URL keeps raw values.
 */
export function TicketBoardFilterBar(props: TicketBoardFilterBarProps) {
  const { initialQuery, placeholder, savedFilterStorageKey } = props;
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() =>
    savedFilterStorageKey ? loadSavedFilters(savedFilterStorageKey) : []
  );

  function updateSavedFilters(
    next: SavedFilter[] | ((prev: SavedFilter[]) => SavedFilter[])
  ) {
    setSavedFilters((prev) => {
      const updated = typeof next === "function" ? next(prev) : next;
      if (savedFilterStorageKey) persistSavedFilters(savedFilterStorageKey, updated);
      return updated;
    });
  }

  const fieldMap: Record<FieldId, FilterField> = {
    company: props.company,
    section: props.section,
    assigned: props.assigned,
    priority: props.priority,
    requestType: props.requestType,
    status: props.status,
    sentBy: props.sentBy ?? HIDDEN_FIELD,
    received: props.received ?? HIDDEN_FIELD,
  };

  function optionLabel(field: FilterField, value: string) {
    return field.options.find((o) => o.value === value)?.label ?? value;
  }

  function optionValue(field: FilterField, label: string) {
    return field.options.find((o) => o.label === label)?.value ?? "ALL";
  }

  function navigate(patch: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    patch(params);
    // Filter changes reset to the first page of results.
    params.delete("page");
    params.delete("logsPage");
    const qs = params.toString();
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function applySearch() {
    const value = query.trim().replace(/^#/, "").trim();
    navigate((params) => {
      if (value) params.set("q", value);
      else params.delete("q");
    });
  }

  const visibleFields = FIELD_DEFS.filter((def) => fieldMap[def.id].visible);

  const filters: Filter[] = visibleFields.flatMap((def) => {
    const field = fieldMap[def.id];
    if (field.value === "ALL") return [];
    return [
      {
        id: def.type,
        type: def.type,
        operator: FilterOperator.IS,
        value: [optionLabel(field, field.value)],
      },
    ];
  });

  const filterOptions: Partial<Record<string, FilterOption[]>> = {};
  for (const def of visibleFields) {
    filterOptions[def.type] = fieldMap[def.id].options
      .filter((o) => o.value !== "ALL")
      .map((o) => ({ name: o.label, icon: undefined, id: o.value }));
  }

  const viewOptions: FilterOption[][] = [
    visibleFields.map((def) => ({
      name: def.type,
      icon: <FilterIcon type={def.type} />,
    })),
  ];

  function applyToUrl(updated: Filter[]) {
    navigate((params) => {
      const byType = new Map(updated.map((f) => [f.type, f.value[f.value.length - 1]]));
      let resetAssigned = false;
      for (const def of FIELD_DEFS) {
        const field = fieldMap[def.id];
        if (!field.visible) continue;
        const label = byType.get(def.type);
        if (label === undefined) {
          params.delete(def.param);
          continue;
        }
        const code = optionValue(field, label);
        if (code === "ALL") params.delete(def.param);
        else params.set(def.param, code);
        if (def.id === "section") {
          const currentSection = new URLSearchParams(window.location.search).get("section") ?? "ALL";
          if (code !== currentSection) resetAssigned = true;
        }
      }
      if (resetAssigned) params.delete("assigned");
    });
  }

  function setFilters(next: Filter[] | ((prev: Filter[]) => Filter[])) {
    const updated = typeof next === "function" ? next(filters) : next;
    applyToUrl(updated);
  }

  function addFilter(type: string, value: string) {
    setFilters((prev) => [...prev.filter((f) => f.type !== type), {
      id: type,
      type,
      operator: FilterOperator.IS,
      value: [value],
    }]);
  }

  function saveCurrentFilter(name: string) {
    const params = new URLSearchParams(window.location.search);
    const captured: Record<string, string> = {};
    for (const def of FIELD_DEFS) {
      const value = params.get(def.param);
      if (value && value !== "ALL") captured[def.param] = value;
    }
    const q = params.get("q");
    if (q) captured.q = q;
    if (Object.keys(captured).length === 0) return;
    updateSavedFilters((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        params: captured,
        createdAt: Date.now(),
      },
    ]);
  }

  function applySavedFilter(filter: SavedFilter) {
    setQuery(filter.params.q ?? "");
    navigate((params) => {
      for (const def of FIELD_DEFS) params.delete(def.param);
      params.delete("q");
      for (const [key, value] of Object.entries(filter.params)) params.set(key, value);
    });
  }

  function deleteSavedFilter(id: string) {
    updateSavedFilters((prev) => prev.filter((f) => f.id !== id));
  }

  const canSaveCurrent = filters.length > 0 || query.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-zinc-300 bg-white p-2 sm:flex-row sm:items-center sm:gap-2 sm:p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center px-1.5 py-1 text-sm text-zinc-700 sm:px-2 dark:text-zinc-300">
          <Search className="mr-2 size-4 shrink-0 text-zinc-600 opacity-90 dark:text-zinc-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={applySearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applySearch();
              }
            }}
            placeholder={placeholder}
            className="w-full min-w-0 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-600 dark:text-zinc-100 dark:placeholder:text-zinc-400"
            aria-label="Search by request number, subject, or customer"
          />
        </label>
      </div>

      {visibleFields.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Filters
            filters={filters}
            setFilters={setFilters}
            filterOptions={filterOptions}
            showOperators={false}
          />
          <FiltersTrigger
            viewOptions={viewOptions}
            filterOptions={filterOptions}
            onSelect={addFilter}
            savedFilters={savedFilterStorageKey ? savedFilters : undefined}
            onSaveFilter={saveCurrentFilter}
            onApplySavedFilter={applySavedFilter}
            onDeleteSavedFilter={deleteSavedFilter}
            canSaveCurrent={canSaveCurrent}
          />
          {filters.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="transition group h-6 text-xs items-center rounded-sm"
              onClick={() => setFilters([])}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
