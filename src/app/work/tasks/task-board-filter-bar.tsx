"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

export type TaskFilterField = {
  visible: boolean;
  value: string;
  options: Array<{ value: string; label: string }>;
  /** Value treated as unfiltered — hidden from chips. Default `all`. */
  emptyValue?: string;
};

type TaskBoardFilterBarProps = {
  initialQuery: string;
  placeholder: string;
  category: TaskFilterField;
  frequency: TaskFilterField;
  company?: TaskFilterField;
  department?: TaskFilterField;
  savedFilterStorageKey?: string;
};

type FieldId = "category" | "frequency" | "company" | "department";

const FIELD_DEFS: Array<{ id: FieldId; type: string; param: string }> = [
  { id: "company", type: "Company", param: "company" },
  { id: "department", type: "Department", param: "department" },
  { id: "category", type: "Category", param: "category" },
  { id: "frequency", type: "Frequency", param: "frequency" },
];

/**
 * Search + filter bar for the Task Board (Board and Timeline Calendar views).
 * Active filters render as chips added via the FiltersTrigger button; every
 * change applies via client-side navigation (router.replace) instead of a full
 * GET reload, mirroring the Request Board filter bar.
 */
export function TaskBoardFilterBar(props: TaskBoardFilterBarProps) {
  const { initialQuery, placeholder, savedFilterStorageKey } = props;
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() =>
    savedFilterStorageKey ? loadSavedFilters(savedFilterStorageKey) : [],
  );

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  function updateSavedFilters(
    next: SavedFilter[] | ((prev: SavedFilter[]) => SavedFilter[]),
  ) {
    setSavedFilters((prev) => {
      const updated = typeof next === "function" ? next(prev) : next;
      if (savedFilterStorageKey) persistSavedFilters(savedFilterStorageKey, updated);
      return updated;
    });
  }

  const fieldMap: Record<FieldId, TaskFilterField | undefined> = {
    category: props.category,
    frequency: props.frequency,
    company: props.company,
    department: props.department,
  };

  function emptyValue(field: TaskFilterField) {
    return (field.emptyValue ?? "all").toLowerCase();
  }

  function isEmpty(field: TaskFilterField, value: string) {
    const v = value.trim().toLowerCase();
    return !v || v === emptyValue(field);
  }

  function optionLabel(field: TaskFilterField, value: string) {
    return field.options.find((o) => o.value === value)?.label ?? value;
  }

  function optionValue(field: TaskFilterField, label: string) {
    const exact = field.options.find((o) => o.label === label);
    if (exact) return exact.value;
    const lower = label.trim().toLowerCase();
    const byLabel = field.options.find((o) => o.label.toLowerCase() === lower);
    if (byLabel) return byLabel.value;
    const byValue = field.options.find(
      (o) => o.value === label || o.value.toLowerCase() === lower,
    );
    if (byValue) return byValue.value;
    return field.emptyValue ?? "all";
  }

  function navigate(patch: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    patch(params);
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

  const visibleFields = FIELD_DEFS.filter((def) => fieldMap[def.id]?.visible);

  const filters: Filter[] = visibleFields.flatMap((def) => {
    const field = fieldMap[def.id];
    if (!field || isEmpty(field, field.value)) return [];
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
    const field = fieldMap[def.id]!;
    filterOptions[def.type] = field.options
      .filter((o) => !isEmpty(field, o.value))
      .map((o) => ({ name: o.label, icon: undefined, id: o.value }));
  }

  const viewOptions: FilterOption[][] = [
    visibleFields.map((def) => ({
      name: def.type,
      icon: <FilterIcon type={def.type} />,
      id: def.id,
    })),
  ];

  function applyToUrl(updated: Filter[]) {
    navigate((params) => {
      const byType = new Map(updated.map((f) => [f.type, f.value[f.value.length - 1]]));
      for (const def of FIELD_DEFS) {
        const field = fieldMap[def.id];
        if (!field?.visible) continue;
        const label = byType.get(def.type);
        if (label === undefined) {
          params.delete(def.param);
          continue;
        }
        const code = optionValue(field, label);
        if (isEmpty(field, code)) params.delete(def.param);
        else params.set(def.param, code);
      }
    });
  }

  function setFilters(next: Filter[] | ((prev: Filter[]) => Filter[])) {
    const updated = typeof next === "function" ? next(filters) : next;
    applyToUrl(updated);
  }

  function addFilter(type: string, value: string) {
    setFilters((prev) => [
      ...prev.filter((f) => f.type !== type),
      {
        id: type,
        type,
        operator: FilterOperator.IS,
        value: [value],
      },
    ]);
  }

  function saveCurrentFilter(name: string) {
    const params = new URLSearchParams(window.location.search);
    const captured: Record<string, string> = {};
    for (const def of FIELD_DEFS) {
      const field = fieldMap[def.id];
      if (!field?.visible) continue;
      const value = params.get(def.param);
      if (value && !isEmpty(field, value)) captured[def.param] = value;
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
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-zinc-300 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:gap-2 sm:p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
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
          aria-label="Search tasks by title"
        />
      </label>

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
